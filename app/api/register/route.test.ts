// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";
import { _clearAllRateLimitsForTests } from "@/server/lib/rateLimit";
import { POST } from "./route";
import User from "@/adapters/database/models/User";

function makeRequest(body: unknown, ip = "203.0.113.9") {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
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

describe("POST /api/register rate limiting", () => {
  it("allows registrations up to the per-IP limit, then 429s regardless of payload validity", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ username: `user${i}`, email: `user${i}@example.com`, password: "password123" }, ip));
      expect(res.status).toBe(201);
    }

    const sixth = await POST(makeRequest({ username: "user5", email: "user5@example.com", password: "password123" }, ip));
    expect(sixth.status).toBe(429);
    expect(await User.findOne({ email: "user5@example.com" })).toBeNull();
  });

  it("tracks the limit independently per source IP", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ username: `a${i}`, email: `a${i}@example.com`, password: "password123" }, "203.0.113.11"));
      expect(res.status).toBe(201);
    }
    // A different IP starts fresh.
    const res = await POST(makeRequest({ username: "b0", email: "b0@example.com", password: "password123" }, "203.0.113.12"));
    expect(res.status).toBe(201);
  });
});
