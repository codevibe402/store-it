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
  // "pausing" is the honest in-between state: pause was requested but the
  // in-flight chunk workers from before the request haven't drained yet
  // (they finish naturally rather than being aborted mid-transfer — see
  // client/lib/telegramWorker.ts). Only once they've actually stopped does
  // the entry become "paused".
  status: "pending" | "resuming" | "pausing" | "paused" | "success" | "error";
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
  // The currently in-flight resumeUpload() call for a given fileId. Lets
  // pause wait for a true drain before reporting "paused", and lets a
  // subsequent resume wait for a prior attempt to fully stop before starting
  // a new one — closing the race where an old worker pool sees the shared
  // pauseRef cleared by a new resume and keeps grabbing chunks from its own
  // independent counter, duplicating uploads. See the matching fix (and
  // fuller explanation) in hooks/useUpload.ts's activeUploadRun.
  const activeResumeRun = useRef(new Map<string, Promise<ResumeResult>>());

  const updateEntry = useCallback((fileId: string, patch: Partial<ResumeEntry>) => {
    setResumeEntries((prev) => prev.map((e) => (e.fileId === fileId ? { ...e, ...patch } : e)));
  }, []);

  const removeEntry = useCallback((fileId: string) => {
    setResumeEntries((prev) => prev.filter((e) => e.fileId !== fileId));
  }, []);

  // Waits for fileId's in-flight resumeUpload() run (if any) to fully
  // drain, then flips it from "pausing" to "paused" — but only if it's
  // still "pausing" at that point. A resume that raced in during the drain
  // already moved status on to "resuming", which must win.
  const settlePauseResume = useCallback((fileId: string) => {
    const finish = () => {
      setResumeEntries((prev) =>
        prev.map((e) => (e.fileId === fileId && e.status === "pausing" ? { ...e, status: "paused" as const } : e))
      );
    };
    const runPromise = activeResumeRun.current.get(fileId);
    if (runPromise) {
      runPromise.catch(() => {}).finally(finish);
    } else {
      finish();
    }
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
    // Wait for a still-draining previous attempt (pause doesn't abort
    // in-flight chunks — see client/lib/telegramWorker.ts) before starting a
    // new one; otherwise the old worker pool sees the shared pauseRef
    // cleared below and keeps grabbing chunks from its own independent
    // counter alongside this new attempt, duplicating chunk uploads.
    const priorRun = activeResumeRun.current.get(pf._id);
    if (priorRun) await priorRun.catch(() => {});

    setResumeEntries((prev) => {
      if (!prev.find((e) => e.fileId === pf._id)) {
        return [...prev, { fileId: pf._id, filename: pf.filename, size: pf.size, status: "resuming", progress: 0 }];
      }
      return prev;
    });
    updateEntry(pf._id, { status: "resuming", progress: 0, error: undefined });
    cancelRef.current = false;
    pauseRef.current = false;

    const runPromise = resumeUpload(pf, file, handle, cancelRef, pauseRef, abortRef, (pct) => {
      updateEntry(pf._id, { progress: pct });
    });
    activeResumeRun.current.set(pf._id, runPromise);
    let result: ResumeResult;
    try {
      result = await runPromise;
    } finally {
      if (activeResumeRun.current.get(pf._id) === runPromise) activeResumeRun.current.delete(pf._id);
    }

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
    // Abort whatever chunk(s) are currently in flight rather than letting
    // them finish naturally — a chunk send in this environment can take
    // 10-100+ seconds, and graceful draining made Pause take just as long
    // to actually take effect. telegramWorker.ts's worker loop already
    // treats an aborted-while-paused chunk as a graceful stop, not an
    // error, and it was never recorded server-side, so it's simply re-sent
    // on resume. Status only becomes "paused" once settlePauseResume
    // confirms that draining has actually finished — see its comment.
    abortRef.current?.abort();
    updateEntry(pf._id, { status: "pausing" });
    settlePauseResume(pf._id);

    try {
      await fetch("/api/files/telegram/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: pf._id }),
      });
    } catch {}
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient, updateEntry, settlePauseResume]);

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
    // Removes a finished (success/error) entry from the list — used by the
    // per-row and "dismiss all" Dismiss actions. Distinct from cancelResume:
    // this doesn't touch the server, it's just clearing a client-side
    // notification for an attempt that already reached a terminal state.
    dismissEntry: removeEntry,
  };
}
