// @vitest-environment node
import crypto from "crypto";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";
import { verifyTelegramLogin, type TelegramLoginPayload } from "./telegram";
import User from "@/adapters/database/models/User";

// Must match vitest.config.ts's TELEGRAM_BOT_TOKEN test env value.
const BOT_TOKEN = "test-bot-token";

function signPayload(payload: Omit<TelegramLoginPayload, "hash">): string {
  const secret = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const dataCheckString = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

function makeValidPayload(overrides: Partial<TelegramLoginPayload> = {}): TelegramLoginPayload {
  const base = {
    id: "12345",
    first_name: "Ada",
    last_name: "Lovelace",
    username: "ada",
    photo_url: "https://example.com/ada.jpg",
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
  return { ...base, hash: signPayload(base) };
}

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

describe("verifyTelegramLogin", () => {
  it("accepts a validly-signed payload and creates a new telegram-provider user", async () => {
    const user = await verifyTelegramLogin(makeValidPayload());
    expect(user.provider).toBe("telegram");

    const dbUser = await User.findOne({ provider: "telegram", providerId: "12345" });
    expect(dbUser).toBeTruthy();
  });

  it("reuses the same user on a repeat login with the same Telegram id", async () => {
    const first = await verifyTelegramLogin(makeValidPayload());
    const second = await verifyTelegramLogin(makeValidPayload());
    expect(second.userId).toBe(first.userId);

    const count = await User.countDocuments({ provider: "telegram", providerId: "12345" });
    expect(count).toBe(1);
  });

  it("rejects a tampered hash", async () => {
    const payload = makeValidPayload();
    payload.hash = "0".repeat(64);
    await expect(verifyTelegramLogin(payload)).rejects.toThrow("Invalid Telegram auth");
  });

  it("rejects an auth_date older than 24 hours", async () => {
    const staleDate = String(Math.floor(Date.now() / 1000) - 90000);
    const payload = makeValidPayload({ auth_date: staleDate });
    await expect(verifyTelegramLogin(payload)).rejects.toThrow("Telegram auth expired");
  });

  it("rejects a payload missing id/hash", async () => {
    await expect(verifyTelegramLogin({})).rejects.toThrow("Missing Telegram auth data");
  });
});
