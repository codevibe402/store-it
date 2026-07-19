// Simple in-memory fixed-window rate limiter — no Redis in this repo, and a
// single-instance in-memory store is an accepted tradeoff for a login/
// register brute-force gate (worst case on a multi-instance deployment is
// the effective limit multiplying by instance count, not a bypass to zero).
// Not suitable for anything that needs to survive a process restart or be
// authoritative across instances.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounds memory under sustained attack from many distinct keys (e.g. one
// attempt per candidate email) — sweeps expired buckets periodically rather
// than on every call. unref()'d so it never keeps the process alive.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweeping() {
  if (sweepTimer || typeof setInterval !== "function") return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export interface RateLimitOptions {
  /** Max attempts allowed within the window. */
  max: number;
  windowMs: number;
}

export interface RateLimitStatus {
  limited: boolean;
  remaining: number;
  retryAfterMs: number;
}

function getBucket(key: string, windowMs: number, now: number): Bucket {
  const existing = buckets.get(key);
  if (existing && existing.resetAt > now) return existing;
  const fresh: Bucket = { count: 0, resetAt: now + windowMs };
  buckets.set(key, fresh);
  return fresh;
}

// Read-only: has this key already hit the limit? Does not consume an
// attempt — callers should check this before doing expensive work (e.g. a
// bcrypt compare), then call recordAttempt()/resetRateLimit() afterward
// based on the outcome.
export function isRateLimited(key: string, opts: RateLimitOptions): RateLimitStatus {
  ensureSweeping();
  const now = Date.now();
  const bucket = getBucket(key, opts.windowMs, now);
  return {
    limited: bucket.count >= opts.max,
    remaining: Math.max(0, opts.max - bucket.count),
    retryAfterMs: Math.max(0, bucket.resetAt - now),
  };
}

// Consumes one attempt against the window. For lockout-style limits (e.g.
// login by email) call this only on failure, and call resetRateLimit() on
// success so legitimate users aren't penalized for earlier typos once they
// get in. For pure volume limits (e.g. registrations per IP) call this
// unconditionally on every attempt instead.
export function recordAttempt(key: string, opts: RateLimitOptions): RateLimitStatus {
  ensureSweeping();
  const now = Date.now();
  const bucket = getBucket(key, opts.windowMs, now);
  bucket.count += 1;
  return {
    limited: bucket.count >= opts.max,
    remaining: Math.max(0, opts.max - bucket.count),
    retryAfterMs: Math.max(0, bucket.resetAt - now),
  };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

// Test-only escape hatch — production code should never need to wipe the
// whole store.
export function _clearAllRateLimitsForTests(): void {
  buckets.clear();
}

// Best-effort client IP extraction. Trusts x-forwarded-for/x-real-ip, which
// is only meaningful behind a proxy that sets them (Vercel, etc.); falls
// back to a constant key so rate limiting still degrades to "limit
// everyone sharing this bucket" rather than silently doing nothing when
// headers are absent (e.g. local dev, direct connections).
export function getClientIp(headers: Headers | Record<string, string | string[] | undefined>): string {
  const get = (name: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(name) ?? undefined;
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const forwarded = get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
