import connectDB from "@/adapters/database/mongoose";
import IdempotencyKey from "@/adapters/database/models/IdempotencyKey";

export class IdempotentReplay<T> extends Error {
  constructor(public status: number, public body: T) {
    super("idempotent replay");
    this.name = "IdempotentReplay";
  }
}

// Runs `fn` at most once per (scope, key). A concurrent or retried caller
// using the same key gets the first call's stored result instead of
// re-executing side effects (e.g. re-issuing a second share link on a
// network-retry double-submit).
export async function withIdempotency<T>(
  scope: string,
  key: string | null | undefined,
  fn: () => Promise<{ status: number; body: T }>
): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key) {
    const result = await fn();
    return { ...result, replayed: false };
  }

  await connectDB();

  try {
    await IdempotencyKey.create({ scope, key, status: "in_progress" });
  } catch (err: unknown) {
    if ((err as { code?: number })?.code === 11000) {
      const existing = await IdempotencyKey.findOne({ scope, key }).lean();
      if (existing?.status === "completed") {
        return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true };
      }
      // Another request with this key is still in flight (or crashed
      // mid-flight before completing). Reject rather than double-execute;
      // the client's retry logic will try again shortly.
      throw new IdempotentReplay(409, { error: "Request with this idempotency key is already in progress" } as unknown as T);
    }
    throw err;
  }

  const result = await fn();
  await IdempotencyKey.updateOne(
    { scope, key },
    { $set: { status: "completed", responseStatus: result.status, responseBody: result.body } }
  );
  return { ...result, replayed: false };
}
