// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";
import { _clearAllRateLimitsForTests } from "@/server/lib/rateLimit";
import { authOptions } from "./config";
import User from "@/adapters/database/models/User";

// NextAuth v4's CredentialsProvider() factory returns a fixed shape
// (id/name/authorize are stubs — always id: "credentials") and stashes the
// real per-call options (including our actual `id` and `authorize`) under
// `.options`; NextAuth's own init merges that in later. Both the
// 'credentials' and 'telegram' providers below are CredentialsProvider()
// calls, so they're indistinguishable by top-level `.id` at this raw
// pre-init stage — match on `.options.id` (our original, real id) instead.
const credentialsProviderConfig = authOptions.providers.find(
  (p) => (p as unknown as { options: { id: string } }).options.id === "credentials",
) as unknown as { options: { authorize: (creds: Record<string, string> | undefined, req: { headers: Record<string, string> }) => Promise<unknown> } };
const credentialsProvider = { authorize: credentialsProviderConfig.options.authorize };

function reqWithIp(ip: string) {
  return { headers: { "x-forwarded-for": ip }, body: {}, query: {}, method: "POST" };
}

// The User model's pre-save hook hashes `password` itself — passing an
// already-hashed value here would double-hash it and break bcrypt.compare
// against the real plaintext later.
async function createCredentialsUser(email: string, plainPassword: string) {
  return User.create({ email, name: "Test User", provider: "credentials", password: plainPassword });
}

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

afterEach(async () => {
  await clearTestDB();
  _clearAllRateLimitsForTests();
});

describe("credentials login rate limiting / lockout", () => {
  it("locks out an account after 5 bad passwords within the window, regardless of source IP", async () => {
    await createCredentialsUser("victim@example.com", "correct-horse");

    for (let i = 0; i < 5; i++) {
      await expect(
        credentialsProvider.authorize({ email: "victim@example.com", password: "wrong-password" }, reqWithIp(`10.0.0.${i}`)),
      ).rejects.toThrow("Invalid credentials");
    }

    // 6th attempt, even from a brand-new IP, with the CORRECT password —
    // the account itself is locked, not just the attacking IP.
    await expect(
      credentialsProvider.authorize({ email: "victim@example.com", password: "correct-horse" }, reqWithIp("10.0.0.99")),
    ).rejects.toThrow("Too many login attempts");
  });

  it("a successful login resets the lockout counter for that account", async () => {
    await createCredentialsUser("gooduser@example.com", "correct-horse");

    for (let i = 0; i < 3; i++) {
      await expect(
        credentialsProvider.authorize({ email: "gooduser@example.com", password: "wrong-pass" }, reqWithIp("10.0.1.1")),
      ).rejects.toThrow("Invalid credentials");
    }

    const user = await credentialsProvider.authorize({ email: "gooduser@example.com", password: "correct-horse" }, reqWithIp("10.0.1.1"));
    expect(user).toBeTruthy();

    // Counter was reset by the success — three more failures shouldn't hit
    // the 5-attempt lockout on their own.
    for (let i = 0; i < 3; i++) {
      await expect(
        credentialsProvider.authorize({ email: "gooduser@example.com", password: "wrong-again" }, reqWithIp("10.0.1.1")),
      ).rejects.toThrow("Invalid credentials");
    }
  });

  it("locks out by source IP too, across different target emails (credential-stuffing net)", async () => {
    for (let i = 0; i < 21; i++) {
      await createCredentialsUser(`stuff${i}@example.com`, "whatever-password");
    }

    for (let i = 0; i < 20; i++) {
      await expect(
        credentialsProvider.authorize({ email: `stuff${i}@example.com`, password: "wrong-guess" }, reqWithIp("198.51.100.50")),
      ).rejects.toThrow("Invalid credentials");
    }

    await expect(
      credentialsProvider.authorize({ email: "stuff20@example.com", password: "wrong-guess" }, reqWithIp("198.51.100.50")),
    ).rejects.toThrow("Too many login attempts");
  });
});
