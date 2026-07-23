// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";
import { _clearAllRateLimitsForTests } from "@/server/lib/rateLimit";
import { verifyCredentials } from "./credentials";
import User from "@/adapters/database/models/User";

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
        verifyCredentials("victim@example.com", "wrong-password", `10.0.0.${i}`),
      ).rejects.toThrow("Invalid credentials");
    }

    // 6th attempt, even from a brand-new IP, with the CORRECT password —
    // the account itself is locked, not just the attacking IP.
    await expect(
      verifyCredentials("victim@example.com", "correct-horse", "10.0.0.99"),
    ).rejects.toThrow("Too many login attempts");
  });

  it("a successful login resets the lockout counter for that account", async () => {
    await createCredentialsUser("gooduser@example.com", "correct-horse");

    for (let i = 0; i < 3; i++) {
      await expect(
        verifyCredentials("gooduser@example.com", "wrong-pass", "10.0.1.1"),
      ).rejects.toThrow("Invalid credentials");
    }

    const user = await verifyCredentials("gooduser@example.com", "correct-horse", "10.0.1.1");
    expect(user).toBeTruthy();

    // Counter was reset by the success — three more failures shouldn't hit
    // the 5-attempt lockout on their own.
    for (let i = 0; i < 3; i++) {
      await expect(
        verifyCredentials("gooduser@example.com", "wrong-again", "10.0.1.1"),
      ).rejects.toThrow("Invalid credentials");
    }
  });

  it("locks out by source IP too, across different target emails (credential-stuffing net)", async () => {
    for (let i = 0; i < 21; i++) {
      await createCredentialsUser(`stuff${i}@example.com`, "whatever-password");
    }

    for (let i = 0; i < 20; i++) {
      await expect(
        verifyCredentials(`stuff${i}@example.com`, "wrong-guess", "198.51.100.50"),
      ).rejects.toThrow("Invalid credentials");
    }

    await expect(
      verifyCredentials("stuff20@example.com", "wrong-guess", "198.51.100.50"),
    ).rejects.toThrow("Too many login attempts");
  });

  it("rejects a google/telegram-provider user attempting password login with a generic message", async () => {
    await User.create({ email: "social@example.com", name: "Social User", provider: "google", providerId: "abc123" });

    await expect(
      verifyCredentials("social@example.com", "whatever-password", "10.0.2.1"),
    ).rejects.toThrow("Invalid credentials");
  });
});
