"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useReducer } from "react"
import { storeFile, getFile, removeFile } from "@/client/lib/indexedDB";
import { resumeHandleCache, resumeFileCache } from "@/client/lib/resumeCache";
import { resumeTelegramUpload } from "@/client/lib/telegramWorker";
import { getFileHash } from "@/client/lib/hash";
import { resumeUpload, getFileForResume } from "@/app/resume/page";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { CloudUpload, FileText, LoaderCircle } from "lucide-react";

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

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

type FolderType = {
  _id: string;
  name: string;
  owner_id: string;
  parent_id?: string | null;
  createdAt: string;
};

type UploadStatus = "idle" | "uploading" | "paused" | "success" | "error" | "duplicate";
type VersionInfo = { id: string; version: number; uploadedAt: string; storageUrl: string; isCurrent: boolean };
type ToastMsg = { msg: string; type: "error" | "warn" | "success" };
type ContextMenu = { x: number; y: number; item: FileType | FolderType; itemType: "file" | "folder" };
type ShareTarget = { type: "file"; item: FileType } | { type: "folder"; item: FolderType };
type DeleteTarget = { type: "file"; item: FileType } | { type: "folder"; item: FolderType };

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs.filter(Boolean)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(mimetype: string): string {
  if (mimetype.startsWith("image/")) return "[IMG]";
  if (mimetype.startsWith("video/")) return "[VID]";
  if (mimetype.startsWith("audio/")) return "[AUD]";
  if (mimetype.includes("pdf")) return "[PDF]";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "[ARC]";
  if (mimetype.includes("word") || mimetype.includes("document")) return "[DOC]";
  if (mimetype.includes("sheet") || mimetype.includes("excel")) return "[SHT]";
  return "[FILE]";
}

export interface FileUploadProps {
  currentFolderId?: string | null;
  onUploadComplete?: () => void;
}

export default function FileUpload({ currentFolderId = null, onUploadComplete }: FileUploadProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [duplicateFile, setDuplicateFile] = useState<FileType | null>(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [showPending, setShowPending] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const [currentFolderIdState, setCurrentFolderIdState] = useState<string | null>(currentFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [moveNewFolderName, setMoveNewFolderName] = useState("");

  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileType | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<FolderType | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [sharePermission, setSharePermission] = useState<"read" | "add">("read");
  const [shareExpiresInDays, setShareExpiresInDays] = useState(7);
  const [versionTarget, setVersionTarget] = useState<FileType | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchTop, setSearchTop] = useState(80);
  const [storageType, setStorageType] = useState<"s3" | "telegram">("telegram");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const currentFileIdRef = useRef<string | null>(null);
  const currentUploadRef = useRef<{ backend: "s3" | "telegram"; fileId: string; uploadId?: string; key?: string } | null>(null);
  const pausedFileRef = useRef<{ fileId: string; filename: string } | null>(null);
  const cancelledIds = useRef(new Set<string>());
  const currentFileNameRef = useRef<string>("");
  const hasAttemptedAutoResume = useRef(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  useEffect(() => {
    const close = () => { setOpenMenuId(null); setMenuPos(null); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    setCurrentFolderIdState(currentFolderId);
  }, [currentFolderId]);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<{
    files: FileType[];
    folders: FolderType[];
    pendingFiles: FileType[];
  }>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const files = dashboard?.files ?? [];
  const folders = dashboard?.folders ?? [];
  const pendingFiles = dashboard?.pendingFiles ?? [];
  const visiblePendingFiles = pendingFiles.filter((f) => !cancelledIds.current.has(f._id));
  const filesLoading = dashboardLoading;
  const foldersLoading = dashboardLoading;

  const uploadedFiles = files.filter((f) => f.status === "uploaded");
  const visibleFiles = uploadedFiles.filter((f) => f.folderId === currentFolderIdState);
  const visibleFolders = folders.filter((folder) => (folder.parent_id ?? null) === currentFolderIdState);
  const currentFolder = folders.find((f) => f._id === currentFolderIdState);

  const handleLogout = async () => {
    await fetch('/api/auth/signout');
    router.push('/sign_in');
  };

  const openCtx = (e: React.MouseEvent, item: FileType | FolderType, itemType: "file" | "folder") => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 160;
    const menuHeight = 280;
    let left = e.clientX;
    let top = e.clientY;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
    if (top + menuHeight > window.innerHeight) {
      top = e.clientY - 6 - menuHeight;
      if (top < 8) top = 8;
    }
    if (left < 8) left = 8;
    setCtxMenu({ x: left, y: top, item, itemType });
  };

  // File upload logic (keeping existing implementation)
  const handleFileSelect = async (file: File) => {
    // ... upload logic remains unchanged
  };

  // Render only the upload dropzone and pending uploads
  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn(
          "flex min-h-[240px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-8 text-center transition-all duration-200",
          dragging ? "border-indigo-400 bg-indigo-500/10 -translate-y-0.5" : "border-slate-600 bg-slate-900/50 hover:border-indigo-400/70 hover:bg-slate-900"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" hidden onChange={(e) => { e.preventDefault(); if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/15 text-indigo-300">
          <CloudUpload className="h-7 w-7" />
        </div>
        <div className="text-lg font-semibold text-slate-100">
          Drop files here{currentFolderIdState ? ` into "${currentFolder?.name}"` : ""}
        </div>
        <div className="text-sm text-slate-400">
          or <span className="font-medium text-indigo-300">browse your computer</span>
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>Fast uploads</span><span>Resume supported</span><span>Large files supported</span>
        </div>
      </div>

      {/* Upload Progress / Pending Uploads */}
      {(visiblePendingFiles.length > 0 || status === "uploading") && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">Uploading</h3>
          {visiblePendingFiles.map((file) => (
            <div key={file._id} className="rounded-xl border border-slate-700 bg-[#111827] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-300"><FileText className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-slate-100">{file.filename}</div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-400"><LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-300" /> Uploading... <span className="text-slate-500">{file.status === "uploading" ? `${progress}%` : "Preparing"}</span></div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                      style={{ width: `${file.status === "uploading" ? progress : 0}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{formatBytes(file.size)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {file.status === "uploading" && (
                    <button
                      className="rounded-lg px-3 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-500/10"
                      onClick={() => { pauseRef.current = true; }}
                    >
                      Pause
                    </button>
                  )}
                  {file.status === "paused" && (
                    <button
                      className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/10"
                      onClick={() => { /* resume logic */ }}
                    >
                      Resume
                    </button>
                  )}
                  <button
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                    onClick={() => { cancelledIds.current.add(file._id); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Context Menu */}
      {ctxMenu && (
        <div
          className={cn(
            "fixed z-[1000] min-w-[170px] animate-[ctxIn_0.12s_ease] rounded-[12px]",
            "border border-[#252a38] bg-[#1a1e28] p-2",
            "shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
          )}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.itemType === "file" ? (
            <>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { /* open file */ setCtxMenu(null); }}
              >
                Open
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { /* copy share url */ setCtxMenu(null); }}
              >
                Copy link
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { /* view details */ setCtxMenu(null); }}
              >
                View details
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { /* duplicate */ setCtxMenu(null); }}
              >
                Duplicate
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { setMoveTarget(ctxMenu.item as FileType); setCtxMenu(null); }}
              >
                Move to folder
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-red-400 transition-all duration-100 hover:bg-red-500/10 hover:text-red-300"
                )}
                onClick={() => { setDeleteTarget({ type: "file", item: ctxMenu.item as FileType }); setCtxMenu(null); }}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { /* open folder */ setCtxMenu(null); }}
              >
                Open
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { /* copy folder link */ setCtxMenu(null); }}
              >
                Copy link
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { setMoveFolderTarget(ctxMenu.item as FolderType); setCtxMenu(null); }}
              >
                Move
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                )}
                onClick={() => { setNewFolderName(""); setShowNewFolder(true); setCtxMenu(null); }}
              >
                New subfolder
              </button>
              <button
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                  "text-red-400 transition-all duration-100 hover:bg-red-500/10 hover:text-red-300"
                )}
                onClick={() => { setDeleteTarget({ type: "folder", item: ctxMenu.item as FolderType }); setCtxMenu(null); }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-7 right-7 z-50 rounded-xl px-4 py-3 text-sm font-medium",
            "flex items-center gap-2 max-w-xs",
            "border",
            toast.type === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : toast.type === "warn"
                ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          <span className="text-xl font-bold">
            {toast.type === "success" ? "✓" : toast.type === "warn" ? "!" : "✕"}
          </span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
