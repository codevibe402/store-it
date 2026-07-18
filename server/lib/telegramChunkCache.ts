import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/adapters/storage/s3";

// Telegram chunk bytes, once fetched, rarely need fetching again — every
// preview/download of the same file re-pays two live network hops per
// chunk to Telegram's API otherwise. This is a write-through hot cache in
// front of Telegram (the source of truth): first fetch populates it, every
// later request for that exact (versionId, chunkIndex) is served from S3 —
// which is also what lets it ride the same presigned-URL/CDN path already
// used for native S3 files. Telegram stays authoritative; this cache is
// always regenerable from it, so losing it is never a correctness problem.
//
// Stores exactly what Telegram returns — ciphertext for encrypted files,
// plaintext for unencrypted ones — never anything decrypted server-side.
// Caching ciphertext is safe regardless of who can reach this S3 key: it's
// meaningless without the file's key, same reasoning already applied to
// dek-mode chunks served directly to clients for local decryption.
const CACHE_PREFIX = "telegram-cache";

function cacheKey(versionId: string, chunkIndex: number): string {
  return `${CACHE_PREFIX}/${versionId}/${chunkIndex}`;
}

export async function getCachedChunk(versionId: string, chunkIndex: number): Promise<Buffer | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey(versionId, chunkIndex) })
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    // NoSuchKey on a miss, or any transient S3 error — either way this is a
    // cache, not a source of truth, so fall through to the live fetch.
    return null;
  }
}

// Best-effort — never throws. Called from `after()` so it never delays the
// response, and a failed cache write just means the next request pays the
// same live-fetch cost again, not a broken download.
export async function cacheChunkBestEffort(versionId: string, chunkIndex: number, data: Buffer): Promise<void> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: cacheKey(versionId, chunkIndex),
        Body: data,
        ContentType: "application/octet-stream",
      })
    );
  } catch (err) {
    console.warn(`[telegramChunkCache] Failed to cache chunk ${versionId}/${chunkIndex}`, err);
  }
}
