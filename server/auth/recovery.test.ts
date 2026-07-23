// @vitest-environment node
import bcrypt from "bcryptjs";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";
import { _clearAllRateLimitsForTests } from "@/server/lib/rateLimit";
import { verifyRecoveryLogin } from "./recovery";
import User from "@/adapters/database/models/User";

// Mirrors client/lib/dek.ts's normalizeRecoveryCode — the real setup flow
// (components/EncryptionSetupModal.tsx) normalizes client-side before ever
// sending the code to the server, so the hash stored here must be of the
// normalized form too, not the raw dashed/mixed-case display string.
function normalize(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

async function createEncryptedUser(email: string, recoveryCode: string) {
  return User.create({
    email,
    name: "Test User",
    provider: "credentials",
    password: "irrelevant-but-required",
    encryptionRecoveryWrapped: "wrapped-ciphertext",
    encryptionRecoveryNonce: "nonce-value",
    encryptionRecoverySalt: "salt-value",
    encryptionRecoveryCodeHash: await bcrypt.hash(normalize(recoveryCode), 10),
    encryptionSetupAt: new Date(),
  });
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

describe("verifyRecoveryLogin", () => {
  it("logs in and returns the wrap fields for a correct email + recovery code", async () => {
    await createEncryptedUser("victim@example.com", "ABCD-EFGH-JKMN");

    const result = await verifyRecoveryLogin("victim@example.com", "ABCD-EFGH-JKMN", "10.0.0.1");
    expect(result.user.email).toBe("victim@example.com");
    expect(result.recoveryWrapped).toBe("wrapped-ciphertext");
    expect(result.recoveryNonce).toBe("nonce-value");
    expect(result.recoverySalt).toBe("salt-value");
  });

  it("normalizes code formatting/casing the same way the client does", async () => {
    await createEncryptedUser("case@example.com", "ABCDEFGHJKMN");

    const result = await verifyRecoveryLogin("CASE@example.com ", "abcd-efgh-jkmn", "10.0.0.2");
    expect(result.user.email).toBe("case@example.com");
  });

  it("rejects a wrong recovery code with a generic message", async () => {
    await createEncryptedUser("wrong@example.com", "ABCD-EFGH-JKMN");

    await expect(
      verifyRecoveryLogin("wrong@example.com", "ZZZZ-ZZZZ-ZZZZ", "10.0.0.3"),
    ).rejects.toThrow("Invalid email or recovery code");
  });

  it("rejects an unknown email with the same generic message (no enumeration)", async () => {
    await expect(
      verifyRecoveryLogin("nobody@example.com", "ABCD-EFGH-JKMN", "10.0.0.4"),
    ).rejects.toThrow("Invalid email or recovery code");
  });

  it("rejects an account that never set up encryption, with the same generic message", async () => {
    await User.create({ email: "noenc@example.com", name: "No Encryption", provider: "credentials", password: "whatever1" });

    await expect(
      verifyRecoveryLogin("noenc@example.com", "ABCD-EFGH-JKMN", "10.0.0.5"),
    ).rejects.toThrow("Invalid email or recovery code");
  });

  it("locks out an account after 5 bad codes within the window, regardless of source IP", async () => {
    await createEncryptedUser("lockout@example.com", "ABCD-EFGH-JKMN");

    for (let i = 0; i < 5; i++) {
      await expect(
        verifyRecoveryLogin("lockout@example.com", "WRONG-CODE-HERE", `10.0.1.${i}`),
      ).rejects.toThrow("Invalid email or recovery code");
    }

    await expect(
      verifyRecoveryLogin("lockout@example.com", "ABCD-EFGH-JKMN", "10.0.1.99"),
    ).rejects.toThrow("Too many attempts");
  });
});
