"use client";

import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getFile, storeFile, removeFile } from "@/client/lib/indexedDB";
import { resumeHandleCache, resumeFileCache } from "@/client/lib/resumeCache";
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

type ResumeResult =
  | { kind: "success" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export type ResumeEntry = {
  fileId: string;
  filename: string;
  size: number;
  status: "pending" | "resuming" | "paused" | "success" | "error";
  progress: number;
  error?: string;
};

async function resumeUpload(
  pendingFile: FileType,
  file: File,
  handle: FileSystemFileHandle | undefined,
  cancelRef: { current: boolean },
  pauseRef: { current: boolean },
  abortRef: { current: AbortController | null },
  onProgress?: (pct: number) => void,
): Promise<ResumeResult> {
  cancelRef.current = false;
  pauseRef.current = false;
  if (handle) {
    resumeHandleCache.set(pendingFile._id, handle);
  }
  // Always persist a recoverable copy keyed by fileId, so a future refresh
  // can resume without reselecting. Prefer the handle (cheaper — IndexedDB
  // just stores a reference); fall back to the file content itself when no
  // handle is available (e.g. browsers without the File System Access API).
  storeFile(pendingFile._id, {
    fileId: pendingFile._id,
    handle,
    blob: handle ? undefined : file,
    filename: file.name,
    size: file.size,
    lastModified: file.lastModified,
    storedAt: Date.now(),
  }).catch(() => {});

  try {
    await resumeTelegramUpload(
      pendingFile._id,
      file,
      (pct) => onProgress?.(pct),
      cancelRef,
      pauseRef,
      abortRef,
    );
    resumeHandleCache.delete(pendingFile._id);
    removeFile(pendingFile._id).catch(() => {});
    return { kind: "success" };
  } catch (err: unknown) {
    const uploadError = err as Error & { isCancelled?: boolean };
    if (uploadError?.isCancelled) {
      return { kind: "cancelled" };
    }
    return { kind: "error", message: uploadError?.message || "Resume failed" };
  }
}

function pickFileFallback(): Promise<{ file: File; handle?: FileSystemFileHandle } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? { file: f } : null);
    };
    input.click();
    setTimeout(() => resolve(null), 60_000);
  });
}

export function useResume() {
  const queryClient = useQueryClient();
  const [resumeEntries, setResumeEntries] = useState<ResumeEntry[]>([]);

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const updateEntry = useCallback((fileId: string, patch: Partial<ResumeEntry>) => {
    setResumeEntries((prev) => prev.map((e) => (e.fileId === fileId ? { ...e, ...patch } : e)));
  }, []);

  const removeEntry = useCallback((fileId: string) => {
    setResumeEntries((prev) => prev.filter((e) => e.fileId !== fileId));
  }, []);

  const cancelResume = useCallback(async (pf: FileType) => {
    cancelRef.current = true;
    pauseRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;

    resumeHandleCache.delete(pf._id);
    removeFile(pf._id).catch(() => {});
    removeEntry(pf._id);

    try {
      await fetch("/api/files/telegram/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: pf._id }),
      });
    } catch {}
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient, removeEntry]);

  const handleResume = useCallback(async (pf: FileType, file: File, handle?: FileSystemFileHandle) => {
    setResumeEntries((prev) => {
      if (!prev.find((e) => e.fileId === pf._id)) {
        return [...prev, { fileId: pf._id, filename: pf.filename, size: pf.size, status: "resuming", progress: 0 }];
      }
      return prev;
    });
    updateEntry(pf._id, { status: "resuming", progress: 0, error: undefined });
    cancelRef.current = false;
    pauseRef.current = false;

    const result = await resumeUpload(pf, file, handle, cancelRef, pauseRef, abortRef, (pct) => {
      updateEntry(pf._id, { progress: pct });
    });

    if (result.kind === "success") {
      updateEntry(pf._id, { status: "success", progress: 100 });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } else if (result.kind === "cancelled") {
      if (!pauseRef.current) {
        resumeHandleCache.delete(pf._id);
        removeFile(pf._id).catch(() => {});
        removeEntry(pf._id);
      }
    } else {
      updateEntry(pf._id, { status: "error", error: result.message, progress: -1 });
    }
  }, [queryClient, updateEntry, removeEntry]);

  const pauseSingleResume = useCallback(async (pf: FileType) => {
    pauseRef.current = true;
    cancelRef.current = false;
    // Don't abort here: chunk workers already stop picking up new chunks as
    // soon as pauseRef flips (see telegramWorker.ts), and any chunk still in
    // flight is left to finish naturally instead of having its connection
    // torn down mid-upload.
    updateEntry(pf._id, { status: "paused" });

    try {
      await fetch("/api/files/telegram/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: pf._id }),
      });
    } catch {}
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient, updateEntry]);

  const startResume = useCallback(async (pf: FileType) => {
    // Try cached handle
    const cachedHandle = resumeHandleCache.get(pf._id);
    if (cachedHandle) {
      try {
        const opts = { mode: "read" as const };
        if (await cachedHandle.queryPermission(opts) !== "granted") {
          await cachedHandle.requestPermission(opts);
        }
        const file = await cachedHandle.getFile();
        await handleResume(pf, file, cachedHandle);
        return;
      } catch {
        resumeHandleCache.delete(pf._id);
        await removeFile(pf._id).catch(() => {});
      }
    }

    // Try cached File from memory
    const cachedFile = resumeFileCache.get(pf._id) || resumeFileCache.get(`${pf.filename}|${pf.size}`);
    if (cachedFile) {
      await handleResume(pf, cachedFile, resumeHandleCache.get(pf._id));
      return;
    }

    // Try IndexedDB lookup (survives a page refresh, unlike the in-memory caches above).
    // Records store either a reopenable handle (File System Access API) or,
    // when that API isn't available, the file content itself as a Blob.
    for (const key of [pf._id, `${pf.filename}|${pf.size}`]) {
      const record = await getFile(key).catch(() => undefined);
      if (!record) continue;

      if (record.handle) {
        try {
          const h = record.handle;
          if (await h.queryPermission({ mode: "read" }) !== "granted") {
            await h.requestPermission({ mode: "read" });
          }
          const f = await h.getFile();
          resumeHandleCache.set(pf._id, h);
          await handleResume(pf, f, h);
          return;
        } catch {
          resumeHandleCache.delete(key);
          await removeFile(key).catch(() => {});
        }
      } else if (record.blob) {
        const f = new File([record.blob], record.filename, { lastModified: record.lastModified });
        await handleResume(pf, f, undefined);
        return;
      }
    }

    // No cache anywhere — only now fall back to prompting the user
    let pickResult: { file: File; handle?: FileSystemFileHandle } | null = null;
    for (let attempt = 0; attempt < 2 && !pickResult; attempt++) {
      if (typeof showOpenFilePicker === "function") {
        try {
          const [fileHandle] = await showOpenFilePicker();
          const file = await fileHandle.getFile();
          pickResult = { file, handle: fileHandle };
        } catch {}
      }
      if (!pickResult) {
        pickResult = await pickFileFallback();
      }
    }
    if (!pickResult) return;

    if (pickResult.handle) {
      resumeHandleCache.set(pf._id, pickResult.handle);
    }
    await handleResume(pf, pickResult.file, pickResult.handle);
  }, [handleResume]);

  return {
    resumeEntries,
    startResume,
    cancelResume,
    pauseSingleResume,
  };
}
