// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isRateLimited,
  recordAttempt,
  resetRateLimit,
  getClientIp,
  _clearAllRateLimitsForTests,
} from "./rateLimit";

beforeEach(() => {
  _clearAllRateLimitsForTests();
});

describe("rate limiter core", () => {
  it("allows attempts under the max and blocks at/after the max", () => {
    const opts = { max: 3, windowMs: 60_000 };
    const key = "test:key1";

    expect(isRateLimited(key, opts).limited).toBe(false);
    recordAttempt(key, opts);
    recordAttempt(key, opts);
    expect(isRateLimited(key, opts).limited).toBe(false); // 2 recorded, max 3
    recordAttempt(key, opts);
    expect(isRateLimited(key, opts).limited).toBe(true); // 3 recorded, at max
  });

  it("resetRateLimit clears the count so a successful attempt un-blocks the key", () => {
    const opts = { max: 1, windowMs: 60_000 };
    const key = "test:key2";
    recordAttempt(key, opts);
    expect(isRateLimited(key, opts).limited).toBe(true);
    resetRateLimit(key);
    expect(isRateLimited(key, opts).limited).toBe(false);
  });

  it("different keys have independent buckets", () => {
    const opts = { max: 1, windowMs: 60_000 };
    recordAttempt("test:a", opts);
    expect(isRateLimited("test:a", opts).limited).toBe(true);
    expect(isRateLimited("test:b", opts).limited).toBe(false);
  });

  it("the window resets after windowMs elapses", () => {
    vi.useFakeTimers();
    try {
      const opts = { max: 1, windowMs: 1000 };
      const key = "test:window";
      recordAttempt(key, opts);
      expect(isRateLimited(key, opts).limited).toBe(true);

      vi.advanceTimersByTime(1001);

      expect(isRateLimited(key, opts).limited).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("remaining and retryAfterMs are sane", () => {
    const opts = { max: 5, windowMs: 60_000 };
    const key = "test:remaining";
    recordAttempt(key, opts);
    recordAttempt(key, opts);
    const status = isRateLimited(key, opts);
    expect(status.remaining).toBe(3);
    expect(status.retryAfterMs).toBeGreaterThan(0);
    expect(status.retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});

describe("getClientIp", () => {
  it("prefers the first address in x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getClientIp(headers)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(getClientIp(headers)).toBe("198.51.100.7");
  });

  it("falls back to a constant key when no proxy headers are present", () => {
    expect(getClientIp(new Headers())).toBe("unknown");
  });

  it("works with a plain header object (NextAuth's authorize req.headers shape)", () => {
    expect(getClientIp({ "x-forwarded-for": "192.0.2.1" })).toBe("192.0.2.1");
  });
});
