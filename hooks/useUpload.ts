"use client";

import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSessionDEK, encryptChunk } from "./useFileEncryption";
import { storeQueueItem, removeQueueItem, getAllQueueItems } from "@/client/lib/uploadQueueDB";
import { storeFile as storeResumeFile } from "@/client/lib/indexedDB";
import { resumeTelegramUpload } from "@/client/lib/telegramWorker";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  hash?: string;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed";
  folderId: string | null;
  createdAt: string;
  backend?: "s3" | "telegram";
};

type UploadStatus = "idle" | "uploading" | "paused" | "success" | "error" | "duplicate";

export type UploadEntry = {
  id: string;
  filename: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error: string;
  duplicateFile: FileType | null;
  fileId?: string;
};

type UploadMeta = {
  file: File;
  fileId: string;
  totalChunks: number;
  chunkSize: number;
  hash: string;
};

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;

// Number of Telegram chunks kept in flight at once. Uploads used to send
// one chunk at a time — unlike the page-refresh resume path in
// client/lib/telegramWorker.ts, which already ran 6 concurrent workers —
// so total wall-clock time was chunk-count times per-chunk latency with
// zero overlap. Matches that already-proven worker count.
const CHUNK_CONCURRENCY = 6;

function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

let uploadIdCounter = 0;
function nextUploadId(): string {
  return `upload_${Date.now()}_${++uploadIdCounter}`;
}

export function useUpload(currentFolderId: string | null) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<UploadEntry[]>([]);

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const pausedIds = useRef(new Set<string>());
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const uploadMeta = useRef<Map<string, UploadMeta>>(new Map());
  const restoredFiles = useRef<Map<string, File>>(new Map());
  const handleFileRef = useRef<((file: File, folderId?: string | null, handle?: FileSystemFileHandle) => Promise<void>) | null>(null);

  const cancelledIds = useRef(new Set<string>());

  const updateUpload = useCallback((id: string, patch: Partial<UploadEntry>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const cancelUpload = useCallback(() => {
    cancelRef.current = true;
    pauseRef.current = false;
    pausedIds.current.clear();
    for (const [id, ctrl] of abortControllers.current) {
      ctrl.abort();
    }
    abortControllers.current.clear();
    setUploads([]);
    uploadMeta.current.clear();
    // Remove all entries from IndexedDB
    for (const u of uploads) {
      removeQueueItem(u.id).catch(() => {});
    }
  }, [uploads]);

  const pauseUpload = useCallback(() => {
    setUploads((prev) => {
      for (const u of prev) {
        if (u.status === "uploading") pausedIds.current.add(u.id);
      }
      return prev.map((u) => (u.status === "uploading" ? { ...u, status: "paused" as const } : u));
    });
  }, []);

  const cancelSingleUpload = useCallback((id: string) => {
    const ctrl = abortControllers.current.get(id);
    if (ctrl) ctrl.abort();
    abortControllers.current.delete(id);
    uploadMeta.current.delete(id);
    restoredFiles.current.delete(id);
    setUploads((prev) => prev.filter((u) => u.id !== id));
    removeQueueItem(id).catch(() => {});
  }, []);

  const pauseSingleUpload = useCallback((id: string) => {
    pausedIds.current.add(id);
    setUploads((prev) =>
      prev.map((u) => (u.id === id && u.status === "uploading" ? { ...u, status: "paused" as const } : u))
    );
  }, []);

  // Shared by both the initial upload (handleFile) and the in-memory resume
  // path (resumeSingleUpload) — previously each had its own near-duplicate,
  // strictly sequential copy of this loop; unifying means both get the same
  // concurrency and the same fix at once instead of drifting apart (see
  // SESSION_EXCHANGE_VULNERABILITY.md §8 for why two independent copies of
  // the same effect is a recurring failure shape in this codebase).
  const uploadChunks = useCallback(async (
    id: string,
    file: File,
    fileId: string,
    totalChunks: number,
    chunkSize: number,
    cryptoKey: CryptoKey | null,
    controller: AbortController,
    existingUploadedBytes: number,
    existingUploadedIndexes: Set<number>,
  ) => {
    let uploadedBytes = existingUploadedBytes;
    const nextIndex = { current: 0 };
    // Set by the first worker that hits a terminal (non-retryable) chunk
    // failure, so sibling workers stop picking up *new* chunks. Deliberately
    // not the shared `controller` — aborting that would make
    // controller.signal.aborted true, and the caller's catch block checks
    // that (meaning "this was a genuine cancel") *before* it ever checks
    // canFallbackToS3, which would silently turn a fallback-eligible
    // failure into a silent cancel instead. Chunks already in flight on
    // other workers are left to finish naturally, not force-aborted.
    const stopped = { current: false };
    let terminalError: unknown = null;

    const uploadOneChunk = async (i: number) => {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBlob = file.slice(start, end);
      const chunkBuf = new Uint8Array(await chunkBlob.arrayBuffer());

      let dataToUpload: Blob;
      let chunkHash: string;
      let nonce: string | undefined;

      if (cryptoKey) {
        const { ciphertext, nonce: iv } = await encryptChunk(chunkBuf, cryptoKey);
        chunkHash = await crypto.subtle.digest("SHA-256", ciphertext as unknown as BufferSource).then(h => {
          const arr = new Uint8Array(h);
          return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
        });
        nonce = bufferToBase64(iv);
        dataToUpload = new Blob([ciphertext as unknown as BlobPart], { type: "application/octet-stream" });
      } else {
        chunkHash = await crypto.subtle.digest("SHA-256", chunkBuf as unknown as BufferSource).then(h => {
          const arr = new Uint8Array(h);
          return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
        });
        dataToUpload = chunkBlob;
      }

      const chunkForm = new FormData();
      chunkForm.append("fileId", fileId);
      chunkForm.append("chunkIndex", String(i));
      chunkForm.append("hash", chunkHash);
      chunkForm.append("chunk", dataToUpload);
      if (nonce) chunkForm.append("nonce", nonce);
      chunkForm.append("useEncryption", cryptoKey ? "false" : "true");

      let success = false;
      let sawCanFallbackToS3 = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        if (cancelRef.current || pauseRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;
        try {
          const chunkRes = await fetch("/api/files/telegram/chunk", {
            method: "POST",
            body: chunkForm,
            signal: controller.signal,
          });
          if (!chunkRes.ok) {
            const errBody = await chunkRes.json().catch(() => ({}));
            // Without Object.assign here, the canFallbackToS3 flag never
            // survives being re-thrown, silently breaking the S3-fallback
            // feature entirely.
            if (errBody.canFallbackToS3) throw Object.assign(new Error("Telegram upload failed; fallback to S3"), { canFallbackToS3: true });
            if (attempt >= 2) throw new Error(`Chunk ${i} failed`);
          } else {
            success = true;
            uploadedBytes += chunkBlob.size;
            updateUpload(id, { progress: Math.round((uploadedBytes / file.size) * 100) });
          }
        } catch (err: unknown) {
          if (cancelRef.current || pauseRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;
          const e = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
          if (e.isCancelled) break;
          if (e.canFallbackToS3) sawCanFallbackToS3 = true;
          if (e.canFallbackToS3 && attempt >= 2) throw e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
      if (!success && !cancelRef.current && !pauseRef.current && !pausedIds.current.has(id) && !controller.signal.aborted) {
        throw Object.assign(new Error(`Chunk ${i} failed after 3 attempts`), { canFallbackToS3: sawCanFallbackToS3 });
      }
    };

    const worker = async () => {
      while (true) {
        if (stopped.current || cancelRef.current || pauseRef.current || pausedIds.current.has(id) || controller.signal.aborted) return;
        const i = nextIndex.current++;
        if (i >= totalChunks) return;
        if (existingUploadedIndexes.has(i)) continue;
        try {
          await uploadOneChunk(i);
        } catch (err) {
          stopped.current = true;
          terminalError = err;
          return;
        }
      }
    };

    const workerCount = Math.min(CHUNK_CONCURRENCY, totalChunks);
    await Promise.all(Array.from({ length: workerCount }, worker));

    if (terminalError) throw terminalError;

    return uploadedBytes;
  }, [updateUpload]);

  // Runs when Telegram signals canFallbackToS3 (3 failed chunk attempts).
  // The server-side fallback route always discards whatever made it to
  // Telegram and hands back a fresh S3 multipart session — see
  // app/api/files/[id]/fallback-to-s3/route.ts — so this drives a full
  // upload from 0%, not a continuation. Note: the S3 path has no
  // client-side-decrypt mechanism (manifest/chunk-data routes are
  // Telegram-only), so a file that was being DEK-encrypted loses that
  // zero-knowledge protection once it falls back — it's stored as
  // plaintext, and the server already resets encryptionMode to "none" to
  // keep the DB record honest about that.
  const fallbackToS3 = useCallback(async (
    id: string,
    file: File,
    fileId: string,
    hash: string,
    controller: AbortController,
  ) => {
    toast.info(`"${file.name}" — Telegram upload failed, retrying via backup storage…`);
    updateUpload(id, { progress: 0, error: "" });

    const switchRes = await fetch(`/api/files/${fileId}/fallback-to-s3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "telegram_failed_after_retries" }),
      signal: controller.signal,
    });
    if (!switchRes.ok) {
      const body = await switchRes.json().catch(() => ({}));
      console.error(`[useUpload] fallbackToS3: switch-to-s3 call failed for file ${fileId} (status ${switchRes.status})`, body.error);
      throw new Error(body.error || "Failed to switch to backup storage");
    }

    const initRes = await fetch("/api/files/fallback-to-s3/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        hash,
      }),
      signal: controller.signal,
    });
    if (!initRes.ok) {
      const body = await initRes.json().catch(() => ({}));
      console.error(`[useUpload] fallbackToS3: init call failed for file ${fileId} (status ${initRes.status})`, body.error);
      throw new Error(body.error || "Failed to start backup upload");
    }
    const { uploadId, key, totalParts } = await initRes.json() as { uploadId: string; key: string; totalParts: number };

    const PART_SIZE = 10 * 1024 * 1024; // must match app/api/files/fallback-to-s3/init/route.ts
    const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

    const presignRes = await fetch("/api/files/upload/multipart/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumbers }),
      signal: controller.signal,
    });
    if (!presignRes.ok) {
      console.error(`[useUpload] fallbackToS3: presign call failed for file ${fileId} (status ${presignRes.status})`);
      throw new Error("Failed to get backup upload URLs");
    }
    const { urls } = await presignRes.json() as { urls: string[] };

    const parts: { PartNumber: number; ETag: string }[] = [];

    for (let i = 0; i < totalParts; i++) {
      if (controller.signal.aborted) throw Object.assign(new Error("Cancelled"), { isCancelled: true });

      const partNumber = i + 1;
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      const partBlob = file.slice(start, end);

      let etag: string | null = null;
      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < 3 && !etag; attempt++) {
        // Mirrors the abort check the Telegram chunk-retry loop already has
        // (see uploadChunks above) — without it, a cancel mid-part-retry
        // fell through to catch the resulting AbortError as a transient
        // failure and burned a full backoff sleep (up to ~3s) retrying a
        // request against an already-aborted signal instead of stopping
        // immediately.
        if (controller.signal.aborted) break;
        try {
          const putRes = await fetch(urls[i], { method: "PUT", body: partBlob, signal: controller.signal });
          if (!putRes.ok) throw new Error(`Backup upload failed on part ${partNumber}`);
          etag = putRes.headers.get("ETag");
          if (!etag) throw new Error(`Backup upload part ${partNumber} returned no ETag`);
        } catch (err) {
          lastErr = err as Error;
          console.warn(`[useUpload] fallbackToS3: part ${partNumber}/${totalParts} attempt ${attempt + 1}/3 failed for file ${fileId}`, err);
          if (attempt < 2 && !controller.signal.aborted) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
      if (!etag) {
        if (controller.signal.aborted) throw Object.assign(new Error("Cancelled"), { isCancelled: true });
        console.error(`[useUpload] fallbackToS3: part ${partNumber}/${totalParts} permanently failed for file ${fileId} after 3 attempts`, lastErr);
        throw lastErr || new Error(`Backup upload part ${partNumber} failed`);
      }

      parts.push({ PartNumber: partNumber, ETag: etag });
      updateUpload(id, { progress: Math.round((partNumber / totalParts) * 100) });
    }

    const completeRes = await fetch("/api/files/upload/multipart/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, parts, fileId }),
      signal: controller.signal,
    });
    if (!completeRes.ok) {
      console.error(`[useUpload] fallbackToS3: complete call failed for file ${fileId} (status ${completeRes.status})`);
      throw new Error("Failed to finish backup upload");
    }
  }, [updateUpload]);

  const resumeSingleUpload = useCallback(async (id: string) => {
    // Check if this is a restored file (from IndexedDB queue, not yet init'd)
    const restoredFile = restoredFiles.current.get(id);
    if (restoredFile) {
      restoredFiles.current.delete(id);
      pausedIds.current.delete(id);

      // Try to find a pending server record for proper resume
      try {
        const dashRes = await fetch("/api/dashboard");
        if (dashRes.ok) {
          const dashData = await dashRes.json();
          const pendingFiles: any[] = dashData.pendingFiles ?? [];
          const match = pendingFiles.find(
            (pf: any) => pf.filename === restoredFile.name && pf.size === restoredFile.size && pf.backend === "telegram"
          );
          if (match) {
            const fileId = match._id;
            const cancelRef = { current: false };
            const pauseRef = { current: false };
            const abortRef = { current: null as AbortController | null };
            updateUpload(id, { status: "uploading", progress: 1, error: "" });
            try {
              await resumeTelegramUpload(fileId, restoredFile, (pct) => {
                updateUpload(id, { progress: pct });
              }, cancelRef, pauseRef, abortRef);
              updateUpload(id, { status: "success", progress: 100 });
              removeQueueItem(id).catch(() => {});
              queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            } catch (err: any) {
              if (err?.isCancelled) {
                setUploads((prev) => prev.filter((u) => u.id !== id));
              } else {
                updateUpload(id, { status: "error", error: err?.message || "Resume failed" });
              }
            }
            return;
          }
        }
      } catch {
        // Dashboard fetch failed, fall through to fresh upload
      }

      // No matching server record — start fresh
      setUploads((prev) => prev.filter((u) => u.id !== id));
      removeQueueItem(id).catch(() => {});
      const hf = handleFileRef.current;
      if (hf) await hf(restoredFile, currentFolderId);
      return;
    }

    const meta = uploadMeta.current.get(id);
    if (!meta) return;

    pausedIds.current.delete(id);
    updateUpload(id, { status: "uploading", progress: 0, error: "" });

    const { file, fileId, totalChunks, chunkSize, hash } = meta;
    const controller = new AbortController();
    abortControllers.current.set(id, controller);

    try {
      // Fetch resume info from server to get already uploaded indexes
      const resumeRes = await fetch(`/api/files/telegram/${fileId}/resume`);
      let uploadedIndexes = new Set<number>();
      let uploadedBytes = 0;
      if (resumeRes.ok) {
        const resumeData = await resumeRes.json();
        uploadedIndexes = new Set<number>(resumeData.uploadedIndexes ?? []);
        uploadedBytes = resumeData.uploadedBytes ?? 0;
      }

      // The DEK is a stable per-account key (unlike the old per-file
      // passphrase-derived key), so resuming just re-reads it fresh — no
      // per-file salt/derivation needed.
      const cryptoKey = getSessionDEK();

      uploadedBytes = await uploadChunks(id, file, fileId, totalChunks, chunkSize, cryptoKey, controller, uploadedBytes, uploadedIndexes);

      abortControllers.current.delete(id);

      if (cancelRef.current) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        removeQueueItem(id).catch(() => {});
        return;
      }

      if (pausedIds.current.has(id)) {
        updateUpload(id, { status: "paused" });
        return;
      }

      const completeRes = await fetch("/api/files/telegram/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
        signal: controller.signal,
      });

      if (!completeRes.ok) throw new Error("Failed to complete upload");

      updateUpload(id, { status: "success", progress: 100 });
      uploadMeta.current.delete(id);
      removeQueueItem(id).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: unknown) {
      const e = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
      if (e.isCancelled || controller.signal.aborted || pausedIds.current.has(id)) {
        abortControllers.current.delete(id);
        setUploads((prev) => prev.filter((u) => u.id !== id));
        removeQueueItem(id).catch(() => {});
        return;
      }

      if (e.canFallbackToS3) {
        try {
          await fallbackToS3(id, file, fileId, hash, controller);
          abortControllers.current.delete(id);
          updateUpload(id, { status: "success", progress: 100 });
          uploadMeta.current.delete(id);
          removeQueueItem(id).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          return;
        } catch (fallbackErr: unknown) {
          abortControllers.current.delete(id);
          const fe = fallbackErr as Error & { isCancelled?: boolean };
          if (fe.isCancelled || controller.signal.aborted) {
            setUploads((prev) => prev.filter((u) => u.id !== id));
            uploadMeta.current.delete(id);
            removeQueueItem(id).catch(() => {});
            return;
          }
          console.error(`[useUpload] S3 fallback failed for upload ${id} (fileId ${fileId})`, fe);
          // The switch-to-s3 call inside fallbackToS3 already succeeded (it's
          // what made the fallback attempt possible), so the file's backend
          // is permanently "s3" server-side by this point even though the
          // upload itself didn't finish. The stale Telegram uploadMeta (its
          // totalChunks/chunkSize describe a backend the file no longer
          // uses) must not survive to a later resume click — otherwise
          // resumeSingleUpload would walk the dead Telegram-chunk resume
          // path against a file the server no longer accepts chunks for.
          uploadMeta.current.delete(id);
          updateUpload(id, { status: "error", error: fe.message || "Backup upload failed" });
          return;
        }
      }

      abortControllers.current.delete(id);
      updateUpload(id, { status: "error", error: e.message || "Upload failed" });
    }
  }, [queryClient, updateUpload, currentFolderId, fallbackToS3, uploadChunks]);

  const removeFromQueue = useCallback(async (id: string) => {
    await removeQueueItem(id).catch(() => {});
  }, []);

  const handleFile = useCallback(async (file: File, folderId?: string | null, handle?: FileSystemFileHandle) => {
    const targetFolderId = folderId ?? currentFolderId;
    const id = nextUploadId();

    const entry: UploadEntry = {
      id,
      filename: file.name,
      size: file.size,
      status: "uploading",
      progress: 0,
      error: "",
      duplicateFile: null,
    };
    setUploads((prev) => [...prev, entry]);

    // Persist to IndexedDB so the file survives page refresh
    if (handle) {
      storeQueueItem(id, {
        id,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
        storedAt: Date.now(),
        handle,
      }).catch(() => {});
    } else if (file.size <= SMALL_FILE_LIMIT) {
      const data = await file.arrayBuffer().catch(() => null);
      if (data) {
        storeQueueItem(id, {
          id,
          filename: file.name,
          size: file.size,
          lastModified: file.lastModified,
          type: file.type,
          storedAt: Date.now(),
          data,
        }).catch(() => {});
      }
    }

    const dek = getSessionDEK();
    const controller = new AbortController();
    abortControllers.current.set(id, controller);

    // Hoisted so the catch block below can reach them for the S3 fallback
    // (a canFallbackToS3 error can only happen after both are set, i.e.
    // once the Telegram chunk loop has actually started).
    let hash = "";
    let fileId: string | undefined;

    try {
      hash = await getFileHash(file);

      if (file.size <= SMALL_FILE_LIMIT) {
        const progressInterval = setInterval(() => {
          updateUpload(id, { progress: Math.min(85, entry.progress + 8) });
        }, 150);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("hash", hash);
        formData.append("folderId", targetFolderId ?? "");

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        clearInterval(progressInterval);

        if (res.status === 409) {
          const body = await res.json();
          updateUpload(id, { status: "duplicate", duplicateFile: body.existingFile, progress: 0 });
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(body.error || `Upload failed (${res.status})`);
        }

        updateUpload(id, { status: "success", progress: 100 });
        removeQueueItem(id).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        return;
      }

      // Large file: Telegram multipart upload. Prefer the account's
      // zero-knowledge DEK when this device has it unlocked; fall back to
      // server-managed encryption if not, so uploads never block on it.
      const useDek = !!dek;
      const useEncryption = !dek;

      const initRes = await fetch("/api/files/telegram/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          hash,
          folderId: targetFolderId,
          useEncryption,
          useDek,
        }),
        signal: controller.signal,
      });

      if (!initRes.ok) {
        const body = await initRes.json().catch(() => ({ error: "Init failed" }));
        throw new Error(body.error || "Failed to init upload");
      }

      const initData = await initRes.json();
      if (initData.isDuplicate) {
        updateUpload(id, { status: "duplicate", duplicateFile: initData.existingFile, progress: 0 });
        return;
      }

      fileId = initData.fileId as string;
      const totalChunks = initData.totalChunks;
      const chunkSize = initData.chunkSize || 4 * 1024 * 1024;

      updateUpload(id, { fileId });

      // Persist the file keyed by server fileId so it survives a page refresh
      // and can be found by the dashboard's resume flow (useResume). Prefer a
      // reopenable handle (File System Access API) when available; otherwise
      // fall back to storing the file content itself as a Blob — IndexedDB
      // backs large Blobs with disk rather than holding them in memory, so
      // this works even in browsers without the File System Access API.
      storeResumeFile(fileId, {
        fileId,
        handle,
        blob: handle ? undefined : file,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        storedAt: Date.now(),
      }).catch(() => {});

      uploadMeta.current.set(id, {
        file,
        fileId,
        totalChunks,
        chunkSize,
        hash,
      });

      const uploadedBytes = await uploadChunks(id, file, fileId, totalChunks, chunkSize, dek, controller, 0, new Set());

      abortControllers.current.delete(id);

      if (cancelRef.current) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        uploadMeta.current.delete(id);
        removeQueueItem(id).catch(() => {});
        return;
      }

      if (pauseRef.current || pausedIds.current.has(id)) {
        updateUpload(id, { status: "paused" });
        return;
      }

      const completeRes = await fetch("/api/files/telegram/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
        signal: controller.signal,
      });

      if (!completeRes.ok) throw new Error("Failed to complete upload");

      updateUpload(id, { status: "success", progress: 100 });
      uploadMeta.current.delete(id);
      removeQueueItem(id).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: unknown) {
      const e = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
      if (e.isCancelled || controller.signal.aborted) {
        abortControllers.current.delete(id);
        setUploads((prev) => prev.filter((u) => u.id !== id));
        uploadMeta.current.delete(id);
        removeQueueItem(id).catch(() => {});
        return;
      }

      if (e.canFallbackToS3 && fileId) {
        try {
          await fallbackToS3(id, file, fileId, hash, controller);
          abortControllers.current.delete(id);
          updateUpload(id, { status: "success", progress: 100 });
          uploadMeta.current.delete(id);
          removeQueueItem(id).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          return;
        } catch (fallbackErr: unknown) {
          abortControllers.current.delete(id);
          const fe = fallbackErr as Error & { isCancelled?: boolean };
          if (fe.isCancelled || controller.signal.aborted) {
            setUploads((prev) => prev.filter((u) => u.id !== id));
            uploadMeta.current.delete(id);
            removeQueueItem(id).catch(() => {});
            return;
          }
          console.error(`[useUpload] S3 fallback failed for upload ${id} (fileId ${fileId})`, fe);
          // See matching comment in resumeSingleUpload's catch block: the
          // file's backend is already permanently "s3" server-side once
          // fallbackToS3 got this far, so stale Telegram uploadMeta must not
          // survive to a later resume click.
          uploadMeta.current.delete(id);
          updateUpload(id, { status: "error", error: fe.message || "Backup upload failed" });
          return;
        }
      }

      abortControllers.current.delete(id);
      updateUpload(id, { status: "error", error: e.message || "Upload failed" });
    }
  }, [currentFolderId, queryClient, updateUpload, uploadChunks, fallbackToS3]);

  // Expose handleFile via ref so resumeSingleUpload can call it
  handleFileRef.current = handleFile;

  const getFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const restoreQueue = useCallback(async (folderId?: string | null) => {
    const items = await getAllQueueItems();
    const newEntries: UploadEntry[] = [];

    for (const [id, item] of items) {
      // Skip entries already in the uploads list
      if (uploads.some((u) => u.id === id)) continue;

      let file: File | null = null;

      // Try FileSystemFileHandle first
      if (item.handle) {
        try {
          const opts = { mode: "read" as const };
          if (await item.handle.queryPermission(opts) !== "granted") {
            await item.handle.requestPermission(opts);
          }
          file = await item.handle.getFile();
        } catch {
          // handle revoked, try data
        }
      }

      // Fall back to stored ArrayBuffer
      if (!file && item.data) {
        try {
          file = new File([item.data], item.filename, { type: item.type, lastModified: item.lastModified });
        } catch {
          // data corrupted, skip
        }
      }

      if (file) {
        restoredFiles.current.set(id, file);
        newEntries.push({
          id,
          filename: item.filename,
          size: item.size,
          status: "paused",
          progress: 0,
          error: "",
          duplicateFile: null,
        });
      }
    }

    if (newEntries.length > 0) {
      setUploads((prev) => [...prev, ...newEntries]);
    }
  }, [uploads]);

  return {
    uploads,
    cancelledIds,
    handleFile,
    removeFromQueue,
    cancelUpload,
    cancelSingleUpload,
    pauseUpload,
    pauseSingleUpload,
    resumeSingleUpload,
    restoreQueue,
  };
}
