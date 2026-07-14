"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { CloudUpload, FileText, LoaderCircle, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useUpload, UploadEntry } from "@/hooks/useUpload";

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;

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

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs.filter(Boolean)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface FileUploadProps {
  currentFolderId?: string | null;
  onUploadComplete?: () => void;
}

export default function FileUpload({ currentFolderId = null, onUploadComplete }: FileUploadProps) {
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  const [currentFolderIdState, setCurrentFolderIdState] = useState<string | null>(currentFolderId);

  useEffect(() => {
    setCurrentFolderIdState(currentFolderId);
  }, [currentFolderId]);

  const uploadHook = useUpload(currentFolderIdState);

  const { data: dashboard } = useQuery<{ pendingFiles: FileType[] }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const pendingFiles = dashboard?.pendingFiles ?? [];
  const visiblePendingFiles = pendingFiles.filter((f) => !uploadHook.cancelledIds.current.has(f._id));

  const hasSuccess = uploadHook.uploads.some((u) => u.status === "success");
  useEffect(() => {
    if (hasSuccess && onUploadComplete) {
      onUploadComplete();
    }
  }, [hasSuccess, onUploadComplete]);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (fileList: FileList) => {
    for (let i = 0; i < fileList.length; i++) {
      uploadHook.handleFile(fileList[i], currentFolderIdState);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Dropzone */}
      <div
        className={cn(
          "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-8 text-center transition-all duration-200",
          dragging ? "border-indigo-400 bg-indigo-500/10 -translate-y-0.5" : "border-slate-600 bg-slate-900/50 hover:border-indigo-400/70 hover:bg-slate-900"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const fileList = e.target.files;
            if (fileList && fileList.length > 0) {
              handleFiles(fileList);
              e.target.value = "";
            }
          }}
        />
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/15 text-indigo-300">
          <CloudUpload className="h-6 w-6" />
        </div>
        <div className="text-lg font-semibold text-slate-100">
          Drop files here
        </div>
        <div className="text-sm text-slate-400">
          or <span className="font-medium text-indigo-300">browse your computer</span>
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>Under 10&nbsp;MB: instant S3</span>
          <span>Large files: Telegram chunks</span>
        </div>
      </div>

      {/* Upload queue */}
      {uploadHook.uploads.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">
            Uploads ({uploadHook.uploads.length})
          </h3>

          {/* Global pause/cancel bar */}
          <div className="flex gap-2">
            <button
              onClick={uploadHook.pauseUpload}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/10"
            >
              Pause all
            </button>
            <button
              onClick={uploadHook.cancelUpload}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10"
            >
              Cancel all
            </button>
          </div>

          {uploadHook.uploads.map((u) => (
            <UploadRow key={u.id} entry={u} onCancel={() => uploadHook.cancelSingleUpload(u.id)} />
          ))}
        </div>
      )}

      {/* Pending files from dashboard */}
      {visiblePendingFiles.length > 0 && uploadHook.uploads.length === 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">Pending uploads</h3>
          {visiblePendingFiles.map((file) => (
            <div key={file._id} className="rounded-xl border border-slate-700 bg-[#111827] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-slate-100">{file.filename}</div>
                  <div className="mt-1 text-sm text-slate-400">{formatBytes(file.size)} <span className="px-1.5 text-slate-600">•</span> Status: <span className="text-amber-300">{file.status}</span></div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a href="/resume" className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/10">Resume</a>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                    onClick={async () => {
                      uploadHook.cancelledIds.current.add(file._id);
                      await fetch("/api/files/telegram/cancel", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ fileId: file._id }),
                      });
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadRow({ entry, onCancel }: { entry: UploadEntry; onCancel: () => void }) {
  const inProgress = entry.status === "uploading" || entry.status === "paused";

  return (
    <div className="rounded-xl border border-slate-700 bg-[#111827] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Icon */}
        <div className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          entry.status === "success" ? "bg-green-500/15 text-green-300" :
          entry.status === "error" ? "bg-red-500/15 text-red-300" :
          entry.status === "duplicate" ? "bg-amber-500/15 text-amber-300" :
          "bg-indigo-500/15 text-indigo-300"
        )}>
          {entry.status === "success" ? <CheckCircle className="h-5 w-5" /> :
           entry.status === "error" ? <XCircle className="h-5 w-5" /> :
           entry.status === "duplicate" ? <AlertCircle className="h-5 w-5" /> :
           <FileText className="h-5 w-5" />}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-slate-100">{entry.filename}</div>
          <div className="mt-1 text-sm text-slate-400">
            {formatBytes(entry.size)}
            {inProgress && (
              <span> <span className="text-slate-500">•</span> {entry.progress}%</span>
            )}
            {entry.status === "paused" && <span className="ml-2 text-amber-300">Paused</span>}
            {entry.status === "success" && <span className="ml-2 text-green-400">Uploaded</span>}
            {entry.status === "duplicate" && <span className="ml-2 text-amber-400">Duplicate</span>}
          </div>

          {/* Progress bar */}
          {inProgress && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                style={{ width: `${entry.progress}%` }}
              />
            </div>
          )}

          {/* Error message */}
          {entry.status === "error" && entry.error && (
            <div className="mt-2 text-sm text-red-400">{entry.error}</div>
          )}
        </div>

        {/* Actions */}
        {inProgress && (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10">
              Cancel
            </button>
          </div>
        )}

        {entry.status === "success" || entry.status === "error" || entry.status === "duplicate" ? (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
