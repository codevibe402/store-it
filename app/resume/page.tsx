"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { getFile, storeFile, removeFile } from "@/lib/indexedDB";

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

type ResumeState = {
  fileId: string;
  backend: string;
  status: string;
  totalChunks?: number;
  chunkSize?: number;
  uploadedIndexes?: number[];
  uploadedBytes?: number;
  totalBytes?: number;
  canResumeTelegram: boolean;
  canFallbackToS3: boolean;
};

type ResumeStates = Record<string, ResumeState>;

const TELEGRAM_CHUNK_SIZE = 4 * 1024 * 1024;
const TELEGRAM_CONCURRENCY = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ResumePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  const [resumingId, setResumingId] = useState<string | null>(null);
  const [resumeProgress, setResumeProgress] = useState<Record<string, number>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeFileMap = useRef(new Map<string, FileSystemFileHandle>()).current;

  const { data: dashboard, isLoading } = useQuery<{
    files: FileType[];
    folders: unknown[];
    pendingFiles: FileType[];
  }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 10000,
  });

  const pendingFiles = dashboard?.pendingFiles ?? [];

  const { data: resumeStates } = useQuery<ResumeStates>({
    queryKey: ["resume-states", pendingFiles.map((f) => f._id)],
    queryFn: async () => {
      const states: ResumeStates = {};
      for (const pf of pendingFiles) {
        if (pf.backend !== "telegram") continue;
        try {
          const res = await fetch(`/api/files/telegram/${pf._id}/resume`);
          if (res.ok) {
            const data = await res.json();
            states[pf._id] = data;
          }
        } catch {}
      }
      return states;
    },
    enabled: isAuthenticated && pendingFiles.length > 0 && pendingFiles.some((f) => f.backend === "telegram"),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  const handleCancel = useCallback(async (pf: FileType) => {
    cancelRef.current = true;
    pauseRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    if (intervalRef.current) clearInterval(intervalRef.current);

    resumeFileMap.delete(pf._id);
    removeFile(pf._id).catch(() => {});
    queryClient.setQueryData<{
      files: FileType[]; folders: unknown[]; pendingFiles: FileType[];
    }>(["dashboard"], (old) =>
      old ? { ...old, pendingFiles: old.pendingFiles.filter((f) => f._id !== pf._id) } : old
    );

    try {
      await fetch("/api/files/telegram/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: pf._id }),
      });
    } catch {}
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient, resumeFileMap]);

  const handlePause = useCallback(async (pf: FileType) => {
    pauseRef.current = true;
    cancelRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    if (intervalRef.current) clearInterval(intervalRef.current);

    try {
      await fetch("/api/files/telegram/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: pf._id }),
      });
    } catch {}
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient]);

  const handleResume = useCallback(async (pf: FileType, file: File, handle?: FileSystemFileHandle) => {
    setResumingId(pf._id);
    setResumeProgress((prev) => ({ ...prev, [pf._id]: 0 }));
    cancelRef.current = false;
    pauseRef.current = false;

    const totalChunks = Math.ceil(file.size / TELEGRAM_CHUNK_SIZE);

    if (handle) {
      resumeFileMap.set(pf._id, handle);
      storeFile(pf._id, {
        fileId: pf._id,
        handle,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        storedAt: Date.now(),
      }).catch(() => {});
    }

    try {
      const resumeRes = await fetch(`/api/files/telegram/${pf._id}/resume`);
      const resumeData = resumeRes.ok ? await resumeRes.json() : null;
      const alreadyUploaded = new Set<number>(resumeData?.uploadedIndexes ?? []);
      let uploadedBytes = resumeData?.uploadedBytes ?? 0;
      setResumeProgress((prev) => ({ ...prev, [pf._id]: Math.round((uploadedBytes / file.size) * 100) }));

      const controller = new AbortController();
      abortRef.current = controller;

      const lock = { current: 0 };

      const worker = async () => {
        while (!cancelRef.current && !pauseRef.current && !controller.signal.aborted) {
          const index = lock.current++;
          if (index >= totalChunks) break;
          if (alreadyUploaded.has(index)) continue;

          const start = index * TELEGRAM_CHUNK_SIZE;
          const chunkBlob = file.slice(start, Math.min(start + TELEGRAM_CHUNK_SIZE, file.size));

          const chunkBuffer = await chunkBlob.arrayBuffer();
          const chunkHashBuffer = await crypto.subtle.digest("SHA-256", chunkBuffer);
          const chunkHash = Array.from(new Uint8Array(chunkHashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          const formData = new FormData();
          formData.append("fileId", pf._id);
          formData.append("chunkIndex", String(index));
          formData.append("hash", chunkHash);
          formData.append("chunk", chunkBlob);

          let success = false;
          for (let attempt = 0; attempt < 3 && !success; attempt++) {
            try {
              if (cancelRef.current || pauseRef.current || controller.signal.aborted) {
                throw { isCancelled: true };
              }
              const res = await fetch("/api/files/telegram/chunk", {
                method: "POST", body: formData, signal: controller.signal,
              });
              if (cancelRef.current || pauseRef.current || controller.signal.aborted) {
                throw { isCancelled: true };
              }
              if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const err = new Error(`Status ${res.status}`) as Error & { canFallbackToS3?: boolean };
                err.canFallbackToS3 = errBody.canFallbackToS3 === true;
                throw err;
              }
              success = true;
              uploadedBytes += chunkBlob.size;
              setResumeProgress((prev) => ({ ...prev, [pf._id]: Math.round((uploadedBytes / file.size) * 100) }));
            } catch (err: unknown) {
              const chunkError = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
              if (cancelRef.current || pauseRef.current || controller.signal.aborted || chunkError?.isCancelled) {
                throw { isCancelled: true };
              }
              if (chunkError.canFallbackToS3) throw chunkError;
              if (attempt < 2) {
                const delay = 1000 * Math.pow(2, attempt);
                await new Promise<void>((resolve, reject) => {
                  if (controller.signal.aborted) { reject({ isCancelled: true }); return; }
                  const t = setTimeout(resolve, delay);
                  controller.signal.addEventListener("abort", () => { clearTimeout(t); reject({ isCancelled: true }); }, { once: true });
                });
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
        body: JSON.stringify({ fileId: pf._id }),
      });
      if (!completeRes.ok) throw new Error("Failed to complete Telegram upload");

      resumeFileMap.delete(pf._id);
      removeFile(pf._id).catch(() => {});
      setResumeProgress((prev) => ({ ...prev, [pf._id]: 100 }));
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setResumingId(null);
    } catch (err: unknown) {
      const uploadError = err as Error & { isCancelled?: boolean };
      if (uploadError?.isCancelled) {
        if (!pauseRef.current) {
          resumeFileMap.delete(pf._id);
          removeFile(pf._id).catch(() => {});
        }
        setResumingId(null);
        return;
      }
      setResumingId(null);
      setErrorMsg(uploadError?.message || "Resume failed");
      setResumeProgress((prev) => ({ ...prev, [pf._id]: -1 }));
    }
  }, [queryClient, resumeFileMap]);

  const onResumeClick = useCallback(async (pf: FileType) => {
    const cachedHandle = resumeFileMap.get(pf._id);
    if (cachedHandle) {
      try {
        const opts = { mode: "read" as const };
        if (await cachedHandle.queryPermission(opts) !== "granted") {
          await cachedHandle.requestPermission(opts);
        }
        const file = await cachedHandle.getFile();
        await handleResume(pf, file, cachedHandle);
        return;
      } catch {}
    }

    const fromDB = await getFile(pf._id);
    if (fromDB) {
      resumeFileMap.set(pf._id, fromDB.handle);
      try {
        const opts = { mode: "read" as const };
        if (await fromDB.handle.queryPermission(opts) !== "granted") {
          await fromDB.handle.requestPermission(opts);
        }
        const file = await fromDB.handle.getFile();
        await handleResume(pf, file, fromDB.handle);
        return;
      } catch {
        resumeFileMap.delete(pf._id);
      }
    }

    try {
      const [fileHandle] = await showOpenFilePicker();
      const file = await fileHandle.getFile();
      resumeFileMap.set(pf._id, fileHandle);
      await handleResume(pf, file, fileHandle);
    } catch {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.onchange = async () => {
        const f = fileInput.files?.[0];
        if (f) await handleResume(pf, f);
      };
      fileInput.click();
    }
  }, [handleResume, resumeFileMap]);

  const getResumeProgress = (pf: FileType): number | null => {
    const rs = resumeStates?.[pf._id];
    if (rs && rs.uploadedBytes != null && rs.totalBytes) {
      return Math.round((rs.uploadedBytes / rs.totalBytes) * 100);
    }
    return null;
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .rp-root {
          --bg: #080a0f; --surface: #0e1118; --surface2: #141820;
          --surface3: #1c2130; --border: #1e2535; --border-light: #252e42;
          --text: #dde2f0; --text-muted: #5a6480; --text-dim: #8892aa;
          --accent: #6c8eff; --green: #34d399; --error: #f87171;
          font-family: 'DM Sans', sans-serif;
          background: var(--bg); min-height: 100vh; color: var(--text);
        }
        .rp-topbar {
          padding: 16px 28px; border-bottom: 1px solid var(--border);
          display: flex; align-items: center; gap: 16px;
          background: rgba(8,10,15,0.85); backdrop-filter: blur(12px);
          position: sticky; top: 0; z-index: 100;
        }
        .rp-back-btn {
          display: flex; align-items: center; gap: 6px;
          background: var(--surface2); border: 1px solid var(--border-light);
          color: var(--text-dim); font-family: 'DM Sans', sans-serif;
          font-size: 0.78rem; font-weight: 500; padding: 6px 12px;
          border-radius: 8px; cursor: pointer; transition: all 0.15s;
        }
        .rp-back-btn:hover { color: var(--text); border-color: #2e3a52; background: var(--surface3); }
        .rp-title { font-size: 1rem; font-weight: 700; color: var(--text); }
        .rp-subtitle { font-size: 0.78rem; color: var(--text-muted); }
        .rp-body { max-width: 720px; margin: 0 auto; padding: 28px 24px; }
        .rp-count { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px; }
        .rp-list { display: flex; flex-direction: column; gap: 8px; }
        .rp-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 14px 18px; transition: all 0.15s;
        }
        .rp-card:hover { border-color: var(--border-light); background: var(--surface2); }
        .rp-card-header {
          display: flex; align-items: center; gap: 12px; margin-bottom: 10px;
        }
        .rp-card-icon {
          width: 36px; height: 36px; border-radius: 9px;
          background: var(--surface2); border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        }
        .rp-card-info { flex: 1; overflow: hidden; }
        .rp-card-name { font-size: 0.85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rp-card-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .rp-badge {
          font-size: 0.6rem; font-weight: 600; padding: 2px 7px; border-radius: 99px;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .rp-badge.telegram { background: rgba(52,211,153,0.12); color: var(--green); border: 1px solid rgba(52,211,153,0.2); }
        .rp-badge.s3 { background: rgba(108,142,255,0.12); color: var(--accent); border: 1px solid rgba(108,142,255,0.2); }
        .rp-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
        .rp-btn {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); font-size: 0.72rem; font-weight: 500;
          padding: 5px 12px; border-radius: 7px; cursor: pointer; transition: all 0.15s;
          font-family: 'DM Sans', sans-serif; white-space: nowrap;
        }
        .rp-btn:hover { background: var(--surface3); border-color: var(--border-light); color: var(--text); }
        .rp-btn.resume { color: var(--accent); border-color: rgba(108,142,255,0.25); }
        .rp-btn.resume:hover { background: rgba(108,142,255,0.1); }
        .rp-btn.pause { color: #fbbf24; border-color: rgba(251,191,36,0.25); }
        .rp-btn.pause:hover { background: rgba(251,191,36,0.1); }
        .rp-btn.cancel { color: var(--error); border-color: rgba(248,113,113,0.25); }
        .rp-btn.cancel:hover { background: rgba(248,113,113,0.1); }
        .rp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .rp-progress-wrap { margin-top: 4px; }
        .rp-bar-bg {
          width: 100%; height: 6px; background: var(--surface3);
          border-radius: 99px; overflow: hidden;
        }
        .rp-bar-fill {
          height: 100%; border-radius: 99px;
          background: linear-gradient(90deg, var(--accent), var(--green));
          transition: width 0.3s ease;
        }
        .rp-bar-fill.complete { background: var(--green); }
        .rp-bar-fill.error { background: var(--error); }
        .rp-progress-label { font-size: 0.68rem; color: var(--text-muted); margin-top: 4px; display: flex; justify-content: space-between; }
        .rp-empty {
          text-align: center; padding: 80px 0; color: var(--text-muted); font-size: 0.85rem;
        }
        .rp-empty-icon { font-size: 2rem; margin-bottom: 12px; opacity: 0.4; }
        .rp-skeleton {
          height: 72px; border-radius: 12px;
          background: linear-gradient(90deg, var(--surface) 25%, var(--surface2) 50%, var(--surface) 75%);
          background-size: 200% 100%; animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .rp-error {
          position: fixed; bottom: 24px; right: 24px;
          background: rgba(248,113,113,0.15); border: 1px solid rgba(248,113,113,0.3);
          color: var(--error); padding: 12px 20px; border-radius: 10px;
          font-size: 0.82rem; backdrop-filter: blur(12px); z-index: 200;
          max-width: 400px;
        }
      `}</style>

      <div className="rp-root">
        <header className="rp-topbar">
          <button className="rp-back-btn" onClick={() => router.push("/dashboard")}>
            ← Back
          </button>
          <div>
            <div className="rp-title">Resume Uploads</div>
            <div className="rp-subtitle">Continue interrupted Telegram uploads</div>
          </div>
        </header>

        <div className="rp-body">
          <div className="rp-count">
            {isLoading ? "Loading…" : `${pendingFiles.length} pending upload${pendingFiles.length !== 1 ? "s" : ""}`}
          </div>

          {isLoading ? (
            <div className="rp-list">
              {[...Array(3)].map((_, i) => <div key={i} className="rp-skeleton" />)}
            </div>
          ) : pendingFiles.length === 0 ? (
            <div className="rp-empty">
              <div className="rp-empty-icon">✓</div>
              <div>No pending uploads to resume</div>
              <div style={{ marginTop: 8, fontSize: "0.78rem" }}>
                All uploads are complete
              </div>
            </div>
          ) : (
            <div className="rp-list">
              {pendingFiles.map((pf) => {
                const active = resumingId === pf._id;
                const progress = resumeProgress[pf._id] ?? getResumeProgress(pf);
                const rs = resumeStates?.[pf._id];

                return (
                  <div key={pf._id} className="rp-card">
                    <div className="rp-card-header">
                      <div className="rp-card-icon">📄</div>
                      <div className="rp-card-info">
                        <div className="rp-card-name">{pf.filename}</div>
                        <div className="rp-card-meta">
                          <span>{formatBytes(pf.size)}</span>
                          <span>{formatDate(pf.createdAt)}</span>
                          <span className={`rp-badge ${pf.backend || "telegram"}`}>
                            {pf.backend || "telegram"}
                          </span>
                          <span style={{ color: "var(--text-dim)" }}>{pf.status}</span>
                        </div>
                      </div>
                      <div className="rp-card-actions">
                        {active ? (
                          <button
                            className="rp-btn pause"
                            onClick={() => handlePause(pf)}
                          >
                            Pause
                          </button>
                        ) : (
                          <button
                            className="rp-btn resume"
                            onClick={() => onResumeClick(pf)}
                          >
                            Resume
                          </button>
                        )}
                        <button
                          className="rp-btn cancel"
                          disabled={active}
                          onClick={() => handleCancel(pf)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    {(active || (progress != null && progress >= 0)) && (
                      <div className="rp-progress-wrap">
                        <div className="rp-bar-bg">
                          <div
                            className={`rp-bar-fill ${progress === 100 ? "complete" : ""} ${progress === -1 ? "error" : ""}`}
                            style={{ width: `${Math.max(0, progress)}%` }}
                          />
                        </div>
                        <div className="rp-progress-label">
                          <span>{active ? "Resuming..." : progress === -1 ? "Failed" : `${progress}%`}</span>
                          {rs && (
                            <span>{rs.uploadedBytes != null ? formatBytes(rs.uploadedBytes) : ""} / {rs.totalBytes != null ? formatBytes(rs.totalBytes) : ""}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {errorMsg && <div className="rp-error">{errorMsg}</div>}
    </>
  );
}
