const TELEGRAM_CHUNK_SIZE = 4 * 1024 * 1024;
const TELEGRAM_CONCURRENCY = 6;

async function getChunkHash(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("Cancelled"), { isCancelled: true }));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(Object.assign(new Error("Cancelled"), { isCancelled: true }));
      },
      { once: true },
    );
  });
}

type CancelPauseRef = { current: boolean };
type AbortRef = { current: AbortController | null };
type ProgressCallback = (pct: number) => void;

export interface TelegramChunkError extends Error {
  canFallbackToS3?: boolean;
  isCancelled?: boolean;
}

export async function resumeTelegramUpload(
  fileId: string,
  blob: Blob,
  onProgress: ProgressCallback,
  cancelRef: CancelPauseRef,
  pauseRef: CancelPauseRef,
  abortRef: AbortRef,
  encryptionMetadata?: { iv: string; key: string },
): Promise<void> {
  const resumeRes = await fetch(`/api/files/telegram/${fileId}/resume`);
  const resumeData = resumeRes.ok ? await resumeRes.json() : null;
  const alreadyUploaded = new Set<number>(resumeData?.uploadedIndexes ?? []);
  let uploadedBytes = resumeData?.uploadedBytes ?? 0;
  const totalSize = blob.size;
  
  // Show initial progress (at least 1%) if nothing uploaded yet
  if (uploadedBytes === 0) {
    onProgress(1);
  } else {
    onProgress(Math.round((uploadedBytes / totalSize) * 100));
  }

  const totalChunks = Math.ceil(blob.size / TELEGRAM_CHUNK_SIZE);
  const controller = new AbortController();
  abortRef.current = controller;
  const signal = controller.signal;

  const lock = { current: 0 };

  async function worker() {
    while (!cancelRef.current && !pauseRef.current && !signal.aborted) {
      const index = lock.current++;
      if (index >= totalChunks) break;
      if (alreadyUploaded.has(index)) continue;

      const start = index * TELEGRAM_CHUNK_SIZE;
      const chunkBlob = blob.slice(start, Math.min(start + TELEGRAM_CHUNK_SIZE, blob.size));
      const chunkHash = await getChunkHash(chunkBlob);

      const formData = new FormData();
      formData.append("fileId", fileId);
      formData.append("chunkIndex", String(index));
      formData.append("hash", chunkHash);
      formData.append("chunk", chunkBlob);
      formData.append("useEncryption", "true");

      let success = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        try {
          if (cancelRef.current || pauseRef.current || signal.aborted) {
            throw { isCancelled: true };
          }
          const res = await fetch("/api/files/telegram/chunk", {
            method: "POST", body: formData, signal,
          });
          if (cancelRef.current || pauseRef.current || signal.aborted) {
            throw { isCancelled: true };
          }
if (!res.ok) {
            const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
            const err = new Error(`Status ${res.status}`) as TelegramChunkError;
            err.canFallbackToS3 = errBody.canFallbackToS3 === true;
            throw err;
          }
          success = true;
          uploadedBytes += chunkBlob.size;
          const progress = Math.round((uploadedBytes / totalSize) * 100);
          // Ensure progress is at least 1% for first chunk
          onProgress(Math.max(1, progress));
         } catch (err: unknown) {
          if (cancelRef.current || pauseRef.current || signal.aborted) {
            throw { isCancelled: true };
          }
          const chunkError = err as TelegramChunkError;
          if (chunkError.isCancelled) throw err;
          if (chunkError.canFallbackToS3) throw chunkError;
          if (attempt < 2) {
            await abortableDelay(1000 * Math.pow(2, attempt), signal);
          } else {
            throw new Error(`Chunk ${index} failed after 3 attempts`);
          }
        }
      }
    }
  }

  const workers = Array.from({ length: TELEGRAM_CONCURRENCY }, () => worker());
  try {
    await Promise.all(workers);
  } catch (err: unknown) {
    abortRef.current = null;
    cancelRef.current = true;
    controller.abort();
    throw err;
  }
  abortRef.current = null;

  if (cancelRef.current || pauseRef.current) throw { isCancelled: true };

  const completeRes = await fetch("/api/files/telegram/complete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, encryptionIv: encryptionMetadata?.iv, encryptionKey: encryptionMetadata?.key }),
  });
  if (!completeRes.ok) throw new Error("Failed to complete Telegram upload");
}
