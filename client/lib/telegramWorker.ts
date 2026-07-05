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
  file: File,
  onProgress: ProgressCallback,
  cancelRef: CancelPauseRef,
  pauseRef: CancelPauseRef,
  abortRef: AbortRef,
): Promise<void> {
  const resumeRes = await fetch(`/api/files/telegram/${fileId}/resume`);
  const resumeData = resumeRes.ok ? await resumeRes.json() : null;
  const alreadyUploaded = new Set<number>(resumeData?.uploadedIndexes ?? []);
  let uploadedBytes = resumeData?.uploadedBytes ?? 0;
  onProgress(Math.round((uploadedBytes / file.size) * 100));

  const totalChunks = Math.ceil(file.size / TELEGRAM_CHUNK_SIZE);
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
      const chunkBlob = file.slice(start, Math.min(start + TELEGRAM_CHUNK_SIZE, file.size));
      const chunkHash = await getChunkHash(chunkBlob);

      const formData = new FormData();
      formData.append("fileId", fileId);
      formData.append("chunkIndex", String(index));
      formData.append("hash", chunkHash);
      formData.append("chunk", chunkBlob);

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
          onProgress(Math.round((uploadedBytes / file.size) * 100));
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
    body: JSON.stringify({ fileId }),
  });
  if (!completeRes.ok) throw new Error("Failed to complete Telegram upload");
}
