"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { CloudUpload, FileText, LoaderCircle } from "lucide-react";
import { useUpload } from "@/hooks/useUpload";
import { useFiles } from "@/hooks/useFiles";
import { useFolders } from "@/hooks/useFolders";
import { ShareDialog, DeleteDialog, VersionsDialog, MoveDialog } from "@/components/dialogs";

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

type ContextMenu = { x: number; y: number; item: FileType | FolderType; itemType: "file" | "folder" };

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

  const [currentFolderIdState, setCurrentFolderIdState] = useState<string | null>(currentFolderId);

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

  const uploadHook = useUpload(currentFolderIdState);
  const fileActions = useFiles(files, folders);
  const folderActions = useFolders(folders, currentFolderIdState);

  const visiblePendingFiles = pendingFiles.filter((f) => !uploadHook.cancelledIds.current.has(f._id));
  const currentFolder = folders.find((f) => f._id === currentFolderIdState);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

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

  // Render only the upload dropzone and pending uploads
  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn(
          "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-8 text-center transition-all duration-200",
          dragging ? "border-indigo-400 bg-indigo-500/10 -translate-y-0.5" : "border-slate-600 bg-slate-900/50 hover:border-indigo-400/70 hover:bg-slate-900"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) uploadHook.handleFile(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" hidden onChange={(e) => { e.preventDefault(); if (e.target.files?.[0]) uploadHook.handleFile(e.target.files[0]); }} />
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/15 text-indigo-300">
          <CloudUpload className="h-6 w-6" />
        </div>
        <div className="text-lg font-semibold text-slate-100">
          Drop files here{currentFolderIdState ? ` into "${currentFolder?.name}"` : ""}
        </div>
        <div className="text-sm text-slate-400">
          or <span className="font-medium text-indigo-300">browse your computer</span>
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>Fast uploads</span><span>Resume supported</span><span>Large files supported</span>
        </div>
      </div>

      {/* Upload Progress / Pending Uploads */}
      {(visiblePendingFiles.length > 0 || uploadHook.status === "uploading") && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-slate-100">Uploading</h3>
          {visiblePendingFiles.map((file) => (
            <div key={file._id} className="rounded-xl border border-slate-700 bg-[#111827] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-300"><FileText className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-slate-100">{file.filename}</div>
                  <div className="mt-1 flex items-center gap-2 text-sm text-slate-400"><LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-300" /> Uploading... <span className="text-slate-500">{file.status === "uploading" ? `${uploadHook.progress}%` : "Preparing"}</span></div>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-indigo-400 transition-all duration-300"
                      style={{ width: `${file.status === "uploading" ? uploadHook.progress : 0}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{formatBytes(file.size)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {file.status === "uploading" && (
                    <button
                      className="rounded-lg px-3 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-500/10"
                      onClick={() => { uploadHook.pauseUpload(); }}
                    >
                      Pause
                    </button>
                  )}
                  {file.status === "paused" && (
                    <button
                      className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/10"
                      onClick={() => { uploadHook.setResumingId(file._id); }}
                    >
                      Resume
                    </button>
                  )}
                  <button
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                    onClick={() => { uploadHook.cancelledIds.current.add(file._id); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadHook.error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{uploadHook.error}</div>
      )}

      {uploadHook.duplicateFile && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">Duplicate file detected: {uploadHook.duplicateFile.filename}</div>
      )}

      {/* Dialogs */}
      <ShareDialog
        shareTarget={fileActions.shareTarget as any}
        setShareTarget={fileActions.setShareTarget as any}
        shareUrl={fileActions.shareUrl}
        setShareUrl={fileActions.setShareUrl}
        shareCopied={fileActions.shareCopied}
        setShareCopied={fileActions.setShareCopied}
        sharePermission={fileActions.sharePermission}
        setSharePermission={fileActions.setSharePermission}
        shareExpiresInDays={fileActions.shareExpiresInDays}
        setShareExpiresInDays={fileActions.setShareExpiresInDays}
        onCopyUrl={() => {
          if (fileActions.shareTarget) {
            const isFolder = fileActions.shareTarget.type === "folder";
            fileActions.copyShareUrl(fileActions.shareTarget.item, isFolder);
          }
        }}
        onGenerateFolderShare={() => {
          if (fileActions.shareTarget?.type === "folder") {
            fileActions.openFolderShareModal(fileActions.shareTarget.item, fileActions.sharePermission);
          }
        }}
        onGenerateFileShare={() => {
          if (fileActions.shareTarget?.type === "file") {
            fileActions.openShareModal(fileActions.shareTarget.item);
          }
        }}
      />
      <DeleteDialog
        deleteTarget={fileActions.deleteTarget as any}
        setDeleteTarget={fileActions.setDeleteTarget as any}
        onDelete={async () => {
          if (!fileActions.deleteTarget) return;
          if (fileActions.deleteTarget.type === "file") {
            await fileActions.deleteFile(fileActions.deleteTarget.item._id);
          } else {
            await fileActions.deleteFolder(fileActions.deleteTarget.item._id);
          }
          fileActions.setDeleteTarget(null);
        }}
      />
      <MoveDialog
        moveTarget={fileActions.moveTarget as any}
        setMoveTarget={fileActions.setMoveTarget as any}
        folders={folders}
        uploadedFiles={files.filter((f) => f.status === "uploaded")}
        currentFolderId={currentFolderIdState}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        onCreateFolder={async () => {
          if (!newFolderName.trim()) return;
          await folderActions.createFolder(newFolderName.trim(), currentFolderIdState);
          setNewFolderName("");
        }}
        onMove={async (targetFolderId) => {
          if (fileActions.moveTarget) {
            await fileActions.moveFile(fileActions.moveTarget, targetFolderId);
          }
          fileActions.setMoveTarget(null);
        }}
      />
      <VersionsDialog
        versionTarget={fileActions.versionTarget}
        setVersionTarget={fileActions.setVersionTarget}
        versions={fileActions.versions}
        versionsLoading={fileActions.versionsLoading}
        onOpenVersion={fileActions.openVersionUrl}
      />
    </div>
  );
}
