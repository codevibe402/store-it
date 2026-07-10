"use client";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useReducer } from "react"
import FileSearch from "./filesearch";
import { storeFile, getFile, removeFile } from "@/client/lib/indexedDB";
import { resumeHandleCache, resumeFileCache } from "@/client/lib/resumeCache";
import { resumeTelegramUpload } from "@/client/lib/telegramWorker";
import { getFileHash } from "@/client/lib/hash";
import { resumeUpload, getFileForResume } from "@/app/resume/page";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...classes: (string | boolean | undefined)[]) {
  return twMerge(clsx(...classes));
}

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

type UploadStatus = "idle" | "uploading" | "paused" | "success" | "error" | "duplicate";

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
  _id: string
  name: string
  owner_id: string
  parent_id?: string | null
  createdAt: string;
};

type ContextMenu = {
  x: number;
  y: number
  item: FileType | FolderType
  itemType: "file" | "folder";
};
type uploadstate = {
  status: UploadStatus
  progress: number
  error: string
  duplicateFile: FileType | null
}
const initialState: uploadstate = {
  status: "idle",
  progress: 0,
  error: "",
  duplicateFile: null
}

type DeleteTarget = { type: "file"; item: FileType } | { type: "folder"; item: FolderType };
type ToastMsg = { msg: string; type: "error" | "warn" | "success" };
type VersionInfo = {
  id: string;
  version: number;
  uploadedAt: string;
  storageUrl: string;
  isCurrent: boolean;
};
type ShareTarget = { type: "file"; item: FileType } | { type: "folder"; item: FolderType };
type UploadError = Error & {
  isCancelled?: boolean;
  isDuplicate?: boolean;
  existingFile?: FileType;
};
type TelegramChunkError = Error & {
  canFallbackToS3?: boolean;
  chunkIndex?: number;
  isCancelled?: boolean;
};

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

type UploadAction =
  | { type: "UPLOAD_START" }
  | { type: "UPLOAD_PROGRESS"; progress: number }
  | { type: "UPLOAD_SUCCESS" }
  | { type: "UPLOAD_ERROR"; message: string };
function reducer(state: uploadstate, action: UploadAction): uploadstate {
  switch (action.type) {
    case "UPLOAD_START":
      return { ...state }
    case "UPLOAD_PROGRESS":
      return { ...state, progress: action.progress }
    case "UPLOAD_SUCCESS":
      return { ...state, status: "success" }
    case "UPLOAD_ERROR":
      return { ...state, status: "error", error: action.message }
  }
}

export default function FileUpload() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const router = useRouter();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [duplicateFile, setDuplicateFile] = useState<FileType | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
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
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFileIdRef = useRef<string | null>(null);
  const currentUploadRef = useRef<{ backend: "s3" | "telegram"; fileId: string; uploadId?: string; key?: string } | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
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
  const pendingLoading = dashboardLoading;

  const uploadedFiles = files.filter((f) => f.status === "uploaded");
  const visibleFiles = uploadedFiles.filter((f) => f.folderId === currentFolderId);
  const visibleFolders = folders.filter((folder) => (folder.parent_id ?? null) === currentFolderId);

  async function parseError(res: Response, fallback: string) {
    const data = await res.json().catch(() => ({}));
    return new Error(data.error || fallback);
  }

  const smallUploadMutation = useMutation({
    mutationFn: async ({ file, hash }: { file: File; hash: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("hash", hash);
      if (currentFolderId) formData.append("folderId", currentFolderId);

      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });
      if (cancelRef.current) throw { isCancelled: true };
      if (res.status === 409) { const d = await res.json(); throw { isDuplicate: true, existingFile: d.existingFile }; }
      if (res.status === 413) throw new Error("File exceeds 10 MB");
      if (res.status === 401) throw new Error("Session expired, please log in again");
      if (!res.ok) throw await parseError(res, `Upload failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  async function multipartUpload(file: File, hash: string, onProgress: (pct: number) => void, onFileId?: (fileId: string) => void) {
    const initRes = await fetch("/api/files/upload/multipart/init", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, folderId: currentFolderId, hash }),
    });
    if (cancelRef.current) throw { isCancelled: true };
    if (initRes.status === 409) { const d = await initRes.json(); throw { isDuplicate: true, existingFile: d.existingFile }; }
    if (!initRes.ok) throw await parseError(initRes, "Failed to initialise multipart upload");
    const { uploadId, key, totalParts, fileId } = await initRes.json();
    currentFileIdRef.current = fileId;
    onFileId?.(fileId);
    currentUploadRef.current = { backend: "s3", fileId, uploadId, key };

    const controller = new AbortController();
    abortRef.current = controller;

    const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
    const presignRes = await fetch("/api/files/upload/multipart/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumbers }),
    });
    if (cancelRef.current) throw { isCancelled: true };
    if (!presignRes.ok) throw new Error("Failed to get presigned URLs");
    const { urls } = await presignRes.json();
    let uploadedBytes = 0;
    try {
      const parts = await Promise.all(urls.map(async (url: string, i: number) => {
        if (cancelRef.current) throw { isCancelled: true };
        const start = i * CHUNK_SIZE;
        const chunk = file.slice(start, start + CHUNK_SIZE);
        const res = await fetch(url, { method: "PUT", body: chunk, signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to upload part ${i + 1}`);
        const ETag = res.headers.get("ETag") ?? "";
        uploadedBytes += chunk.size;
        onProgress(Math.round((uploadedBytes / file.size) * 100));
        return { PartNumber: i + 1, ETag };
      }));
      if (cancelRef.current) throw { isCancelled: true };
      const completeRes = await fetch("/api/files/upload/multipart/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, uploadId, parts, fileId }),
      });
      if (!completeRes.ok) throw new Error("Failed to complete multipart upload");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      return completeRes.json();
    } finally {
      abortRef.current = null;
      currentUploadRef.current = null;
    }
  }

  async function s3FallbackUpload(file: File, hash: string, fileId: string, onProgress: (pct: number) => void) {
    if (file.size < SMALL_FILE_LIMIT) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("hash", hash);
      formData.append("fileId", fileId);

      const res = await fetch("/api/files/upload", {
        method: "POST", body: formData,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "S3 fallback upload failed" }));
        if (errBody.error === "Duplicate file") {
          throw { isDuplicate: true, existingFile: errBody.existingFile };
        }
        throw new Error(errBody.error || "S3 fallback upload failed");
      }
      onProgress(100);
      return res.json();
    }

    const initRes = await fetch(`/api/files/fallback-to-s3/init`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name, mimeType: file.type, size: file.size, hash, fileId,
      }),
    });
    if (!initRes.ok) {
      const errBody = await initRes.json().catch(() => ({ error: "Failed to init S3 multipart fallback" }));
      if (errBody.error === "Duplicate file") {
        throw { isDuplicate: true, existingFile: errBody.existingFile };
      }
      throw new Error(errBody.error || "Failed to init S3 multipart fallback");
    }
    const { uploadId, key, totalParts } = await initRes.json();

    const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
    const presignRes = await fetch("/api/files/upload/multipart/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumbers }),
    });
    if (!presignRes.ok) throw new Error("Failed to get presigned URLs");
    const { urls } = await presignRes.json();

    let uploadedBytes = 0;
    const parts = await Promise.all(urls.map(async (url: string, i: number) => {
      if (cancelRef.current) throw { isCancelled: true };
      const start = i * CHUNK_SIZE;
      const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
      const res = await fetch(url, { method: "PUT", body: chunk });
      if (!res.ok) throw new Error(`Failed to upload part ${i + 1}`);
      const ETag = res.headers.get("ETag") ?? "";
      uploadedBytes += chunk.size;
      onProgress(Math.round((uploadedBytes / file.size) * 100));
      return { PartNumber: i + 1, ETag };
    }));

    const completeRes = await fetch("/api/files/upload/multipart/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, parts, fileId }),
    });
    if (!completeRes.ok) throw new Error("Failed to complete S3 multipart fallback");

    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    return completeRes.json();
  }

  async function telegramUpload(file: File, hash: string, onProgress: (pct: number) => void, onFileId?: (fileId: string) => void) {
    const initRes = await fetch("/api/files/telegram/init", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name, size: file.size, hash,
        mimeType: file.type, folderId: currentFolderId,
        useEncryption: true,
      }),
    });
    if (cancelRef.current) throw { isCancelled: true };
    if (initRes.status === 409) { const d = await initRes.json(); throw { isDuplicate: true, existingFile: d.existingFile }; }
    if (!initRes.ok) {
      const errBody = await initRes.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(`Telegram upload failed: ${errBody.error || initRes.statusText}`);
    }
    const { fileId } = await initRes.json();
    currentFileIdRef.current = fileId;
    onFileId?.(fileId);
    currentUploadRef.current = { backend: "telegram", fileId };

    cancelRef.current = false;
    pauseRef.current = false;

    try {
      await resumeTelegramUpload(fileId, file, onProgress, cancelRef, pauseRef, abortRef);
    } catch (err: unknown) {
      const uploadError = err as TelegramChunkError;
      abortRef.current = null;
      cancelRef.current = true;

      if (uploadError?.canFallbackToS3) {
        currentFileIdRef.current = null;
        currentUploadRef.current = null;
        try {
          const fallbackRes = await fetch(`/api/files/${fileId}/fallback-to-s3`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "telegram_chunk_failed" }),
          });
          if (!fallbackRes.ok) {
            const fbErr = await fallbackRes.json().catch(() => ({ error: "Fallback failed" }));
            if (fbErr.error === "Duplicate file") {
              throw { isDuplicate: true, existingFile: fbErr.existingFile };
            }
            throw new Error(fbErr.error || "Fallback to S3 failed");
          }
          onProgress(0);
          await s3FallbackUpload(file, hash, fileId, onProgress);
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          return;
        } catch (fallbackErr: unknown) {
          const fallbackError = fallbackErr as UploadError;
          if (fallbackError?.isDuplicate) {
            setDuplicateFile(fallbackError.existingFile ?? null);
            setToast({ msg: "This file already exists in your storage.", type: "warn" });
            return;
          }
          const message = fallbackError instanceof Error ? fallbackError.message : "Unknown fallback error";
          throw new Error(`Telegram upload failed and S3 fallback also failed: ${message}`);
        }
      }

      currentFileIdRef.current = null;
      currentUploadRef.current = null;
      throw uploadError;
    }

    currentFileIdRef.current = null;
    currentUploadRef.current = null;
    if (cancelRef.current || pauseRef.current) throw { isCancelled: true };

    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  async function uploadSmart(file: File, hash: string, onProgress: (pct: number) => void, onFileId?: (fileId: string) => void) {
    if (storageType === "telegram") {
      return telegramUpload(file, hash, onProgress, onFileId);
    }
    return file.size < SMALL_FILE_LIMIT
      ? smallUploadMutation.mutateAsync({ file, hash })
      : multipartUpload(file, hash, onProgress, onFileId);
  }

  const getFileUrl = async (key: string): Promise<string> => {
    const res = await fetch("/api/files/fetch/url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error("Failed to get file URL");
    return (await res.json()).url;
  };

  const openFile = async (file: FileType) => {
    window.open(`/api/files/${file._id}/download?preview=1`, "_blank");
  };

  const downloadFile = async (file: FileType) => {
    try {
      if (file.backend === "telegram") {
        const res = await fetch(`/api/files/telegram/${file._id}/download`);
        if (!res.ok) throw new Error("Telegram download failed");
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl; a.download = file.filename; a.click();
        window.URL.revokeObjectURL(blobUrl);
      } else {
        const url = await getFileUrl(file.storageUrl);
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl; a.download = file.filename; a.click();
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch { setToast({ msg: "Download failed.", type: "error" }); }
  };

  const downloadFolder = async (folder: FolderType) => {
    try {
      const res = await fetch(`/api/folders/${folder._id}/download`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${folder.name}.zip`; a.click();
      window.URL.revokeObjectURL(url);
      setToast({ msg: `"${folder.name}" downloaded as ZIP.`, type: "success" });
    } catch { setToast({ msg: "Folder download failed.", type: "error" }); }
  };

  const openShareModal = async (file: FileType) => {
    setShareTarget({ type: "file", item: file }); setShareUrl(""); setShareCopied(false);
    try {
      const res = await fetch(`/api/files/${file._id}/share`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const { shareUrl: url } = await res.json();
      setShareUrl(url);
    } catch {
      setToast({ msg: "Could not generate share link.", type: "error" });
      setShareTarget(null);
    }
  };

  const openFolderShareModal = async (folder: FolderType, permission: "read" | "add" = "read") => {
    setShareTarget({ type: "folder", item: folder });
    setShareUrl("");
    setShareCopied(false);
    setSharePermission(permission);
    try {
      const res = await fetch(`/api/folders/${folder._id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permission, expiresInDays: shareExpiresInDays }),
      });
      if (!res.ok) throw new Error("Failed");
      const { shareUrl: url } = await res.json();
      setShareUrl(url);
    } catch {
      setToast({ msg: "Could not generate folder share link.", type: "error" });
      setShareTarget(null);
    }
  };

  const refreshFolderShare = () => {
    if (shareTarget?.type !== "folder") return;
    openFolderShareModal(shareTarget.item, sharePermission);
  };

  const openVersions = async (file: FileType) => {
    setVersionTarget(file);
    setVersions([]);
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/files/${file._id}/versions`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch {
      setToast({ msg: "Could not load version history.", type: "error" });
      setVersionTarget(null);
    } finally {
      setVersionsLoading(false);
    }
  };

  const openVersionUrl = async (version: VersionInfo) => {
    if (!versionTarget) return;
    const res = await fetch(`/api/files/${versionTarget._id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageUrl: version.storageUrl }),
    });
    if (!res.ok) {
      setToast({ msg: "Could not open that version.", type: "error" });
      return;
    }
    const { url } = await res.json();
    window.open(url, "_blank");
  };

  const copyShareUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  };

  const moveFile = async (file: FileType, targetFolderId: string | null) => {
    try {
      const res = await fetch(`/api/files/${file._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setMoveTarget(null);
      setToast({ msg: `Moved to ${targetFolderId ? folders.find(f => f._id === targetFolderId)?.name : "root"}.`, type: "success" });
    } catch { setToast({ msg: "Move failed.", type: "error" }); }
  };

  const createFolderAndMoveFile = async () => {
    const name = moveNewFolderName.trim();
    if (!name || !moveTarget) return;

    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: null }),
      });
      const folder = await res.json();
      if (!res.ok) throw new Error(folder.error || "Failed");

      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setMoveNewFolderName("");
      await moveFile(moveTarget, folder._id);
      setToast({ msg: `Created "${name}" and moved the file there.`, type: "success" });
    } catch {
      setToast({ msg: "Could not create folder for move.", type: "error" });
    }
  };

  const moveFolder = async (folder: FolderType, targetFolderId: string | null) => {
    try {
      const res = await fetch(`/api/folders/${folder._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: targetFolderId }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setMoveFolderTarget(null);
      setToast({ msg: `Moved folder to ${targetFolderId ? folders.find(f => f._id === targetFolderId)?.name : "root"}.`, type: "success" });
    } catch { setToast({ msg: "Folder move failed.", type: "error" }); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "file") {
        const res = await fetch(`/api/files/${deleteTarget.item._id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed");
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        setToast({ msg: `"${(deleteTarget.item as FileType).filename}" deleted.`, type: "success" });
      } else {
        const res = await fetch(`/api/folders/${deleteTarget.item._id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed");
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        if (currentFolderId === deleteTarget.item._id) setCurrentFolderId(null);
        setToast({ msg: `"${deleteTarget.item.name}" deleted.`, type: "success" });
      }
    } catch { setToast({ msg: "Delete failed.", type: "error" }); }
    setDeleteTarget(null);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/folders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: currentFolderId }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setNewFolderName(""); setShowNewFolder(false);
      setToast({ msg: `Folder "${name}" created.`, type: "success" });
    } catch { setToast({ msg: "Could not create folder.", type: "error" }); }
  };

  const handleCancel = async () => {
    cancelRef.current = true;
    pauseRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    if (intervalRef.current) clearInterval(intervalRef.current);

    const meta = currentUploadRef.current;
    currentFileIdRef.current = null;
    currentUploadRef.current = null;
    setStatus("idle");
    setProgress(0);
    if (meta?.fileId) {
      resumeFileCache.delete(meta.fileId);
      cancelledIds.current.add(meta.fileId);
      resumeHandleCache.delete(meta.fileId);
      removeFile(meta.fileId).catch(() => {});
    }
    setToast({ msg: "Upload cancelled.", type: "warn" });

    if (meta) {
      try {
        if (meta.backend === "telegram") {
          await fetch("/api/files/telegram/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: meta.fileId }),
          });
        } else {
          await fetch("/api/files/upload/multipart/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: meta.fileId, uploadId: meta.uploadId, key: meta.key }),
          });
        }
      } catch {
        setToast({ msg: "Upload stopped locally, but cleanup may need a refresh.", type: "warn" });
      } finally {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    }
  };

  const handlePause = async () => {
    pauseRef.current = true;
    abortRef.current?.abort();
    if (intervalRef.current) clearInterval(intervalRef.current);

    const meta = currentUploadRef.current;
    if (meta) {
      pausedFileRef.current = { fileId: meta.fileId, filename: currentFileNameRef.current || "Upload" };
    }
    setStatus("paused"); setProgress(0);
    setToast({ msg: "Upload paused. You can resume later.", type: "warn" });

    if (meta) {
      try {
        await fetch("/api/files/telegram/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: meta.fileId }),
        });
      } catch { }
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  const handleFile = async (file: File, handle?: FileSystemFileHandle) => {
    setStatus("uploading"); setProgress(0);
    currentFileNameRef.current = file.name;
    setErrorMsg(""); setDuplicateFile(null);
    cancelRef.current = false;
    pauseRef.current = false;
    if (file.size < SMALL_FILE_LIMIT) {
      intervalRef.current = setInterval(() => setProgress((p) => (p < 85 ? p + 8 : p)), 150);
    }

    let capturedFileId: string | null = null
    const identityKey = `${file.name}|${file.size}`
    resumeFileCache.set(identityKey, file)
    if (handle) {
      fileHandleRef.current = handle
      resumeHandleCache.set(identityKey, handle)
      storeFile(identityKey, {
        fileId: identityKey,
        handle,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        storedAt: Date.now(),
      }).catch(() => {})
    }
    const onFileId = (fileId: string) => {
      capturedFileId = fileId
      resumeFileCache.set(fileId, file)
      if (handle) {
        resumeHandleCache.set(fileId, handle)
        storeFile(fileId, {
          fileId,
          handle,
          filename: file.name,
          size: file.size,
          lastModified: file.lastModified,
          storedAt: Date.now(),
        }).catch(() => {})
      }
    }

    try {
      const hash = await getFileHash(file);
      await uploadSmart(file, hash, (pct) => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        setProgress(pct);
      }, onFileId);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (!cancelRef.current) {
        setProgress(100); setStatus("success");
        setToast({ msg: `"${file.name}" uploaded successfully!`, type: "success" });
        setTimeout(() => setStatus("idle"), 3000);
      }
      if (capturedFileId && handle) {
        resumeHandleCache.delete(capturedFileId)
        removeFile(capturedFileId).catch(() => {})
      }
      if (identityKey) {
        resumeHandleCache.delete(identityKey)
        removeFile(identityKey).catch(() => {})
      }
    } catch (err: unknown) {
      const uploadError = err as UploadError;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (uploadError?.isCancelled) return;
      if (uploadError?.isDuplicate) {
        setStatus("duplicate"); setDuplicateFile(uploadError.existingFile ?? null);
        setToast({ msg: "This file already exists in your storage.", type: "warn" });
      } else {
        setStatus("error"); setErrorMsg(uploadError?.message || "Upload failed");
        setToast({ msg: uploadError?.message || "Upload failed.", type: "error" });
      }
    }
  };

  const startResumeUpload = async (pf: FileType, file: File, handle?: FileSystemFileHandle) => {
    setResumingId(pf._id);
    setStatus("uploading");
    setProgress(0);
    currentFileNameRef.current = file.name;
    if (handle) fileHandleRef.current = handle;
    cancelRef.current = false;
    pauseRef.current = false;

    const result = await resumeUpload(pf, file, handle, cancelRef, pauseRef, abortRef, (pct) => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setProgress(pct);
    });

    if (result.kind === "success") {
      setProgress(100);
      setStatus("success");
      setToast({ msg: `"${file.name}" upload resumed and completed!`, type: "success" });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setTimeout(() => setStatus("idle"), 3000);
    } else if (result.kind === "cancelled") {
    } else {
      setStatus("error");
      setErrorMsg(result.message);
      setToast({ msg: result.message || "Resume failed.", type: "error" });
    }
    setResumingId(null);
  };

  useEffect(() => {
    if (hasAttemptedAutoResume.current) return
    if (!pendingFiles.length) return
    hasAttemptedAutoResume.current = true
    pendingFiles.forEach(async (pf) => {
      try {
        let record = await getFile(pf._id)
        if (!record) {
          const identityKey = `${pf.filename}|${pf.size}`
          record = await getFile(identityKey)
        }
        if (!record) return
        resumeHandleCache.set(pf._id, record.handle)
        const opts = { mode: "read" as const }
        let permission = await record.handle.queryPermission(opts)
        if (permission !== "granted") {
          permission = await record.handle.requestPermission(opts)
        }
        if (permission !== "granted") return
        const file = await record.handle.getFile()
        const hash = await getFileHash(file)
        if (pf.hash && hash !== pf.hash) {
          removeFile(pf._id).catch(() => {})
          resumeHandleCache.delete(pf._id)
          return
        }
        startResumeUpload(pf, file, record.handle)
      } catch {
        removeFile(pf._id).catch(() => {})
        resumeHandleCache.delete(pf._id)
      }
    })
  }, [pendingFiles])

  const handlePickFile = async () => {
    if (typeof showOpenFilePicker === 'function') {
      try {
        const [fileHandle] = await showOpenFilePicker()
        const file = await fileHandle.getFile()
        handleFile(file, fileHandle)
        return
      } catch { }
    }
    inputRef.current?.click()
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const openCtx = (e: React.MouseEvent, item: FileType | FolderType, itemType: "file" | "folder") => {
    e.preventDefault(); e.stopPropagation();
    const menuWidth = 170;
    const menuHeight = 260;
    let left = e.clientX;
    let top = e.clientY;
    if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
    if (top + menuHeight > window.innerHeight - 8) top = window.innerHeight - 8 - menuHeight;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setCtxMenu({ x: left, y: top, item, itemType });
  };

  const currentFolder = folders.find((f) => f._id === currentFolderId);

  return (
    <>
      <div className="w-full min-h-screen bg-[#0a0b0f] flex flex-col gap-8 px-6 py-10 relative overflow-hidden">
        <div className="absolute -top-40 -left-32 h-[600px] w-[600px] rounded-full bg-indigo-500/20 blur-[120px]" />
        <div className="absolute -bottom-28 -right-20 h-[500px] w-[500px] rounded-full bg-violet-500/15 blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[120px]" />

        {showSearch && <FileSearch onClose={() => setShowSearch(false)} topOffset={searchTop} />}

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8">
          <header className="flex items-center justify-between">
            <h1 className="bg-gradient-to-r from-white to-indigo-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              StoreIt
            </h1>
            <div className="flex items-center gap-2">
              <button
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium transition hover",
                  "border-red-400/20 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                )}
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    fetch('/api/auth/signout');
                  }
                }}
              >
                Logout
              </button>
            </div>
          </header>

          <div className="w-full">
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-[#6b7280]">Storage</div>
                <div className="flex gap-2">
                  <button
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition hover",
                      "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                    )}
                    onClick={() => setShowSearch(true)}
                  >
                    <svg className="inline-block w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21L14.35 14.35"/></svg>
                  </button>
                  <button
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition hover",
                      "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                    )}
                    onClick={() => router.push("/all-files")}
                  >
                    All files
                  </button>
                  <button
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition hover accent",
                      "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                    )}
                    onClick={() => router.push("/sidebar")}
                  >
                    Browse by type
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  {currentFolder && (
                    <button
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover",
                        "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                      )}
                      onClick={() => setCurrentFolderId(currentFolder.parent_id ?? null)}
                    >
                      ← Back
                    </button>
                  )}
                  <span className="text-xs text-[#6b7280] font-medium">
                    {currentFolder
                      ? `${visibleFiles.length} file${visibleFiles.length !== 1 ? 's' : ''} in "${currentFolder.name}"`
                      : "Drop files to upload, or browse from your device."
                    }
                  </span>
                </div>

                <div
                  className={cn(
                    "rounded-2xl border-dashed transition-all duration-200 cursor-pointer",
                    "border-[1.5px] p-8 text-center gap-4 flex flex-col items-center justify-center",
                    dragging ? "border-accent border-solid bg-[#6c8eff1a] transform -translate-y-1" : "border-[#252a38]"
                  )}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={handlePickFile}
                >
                  <input ref={inputRef} type="file" hidden onChange={onInputChange} />
                  <div className="w-12 h-12 rounded-xl bg-[#1a1e28] border border-[#252a38] flex items-center justify-center">
                    <svg className="w-6 h-6 text-[#6c8eff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
                  </div>
                  <div className="text-xl font-semibold text-[#e8eaf0]">
                    Drop your file here{currentFolder ? ` into "${currentFolder.name}"` : ""}
                  </div>
                  <div className="text-sm text-[#6b7280]">
                    or <span className="text-[#6c8eff] font-medium">browse</span> — under 10 MB uploads instantly, larger files use multipart
                  </div>
                </div>

                {(status === "uploading" || status === "paused" || (!showPending && visiblePendingFiles.length > 0)) && (
                  <div className="flex flex-col gap-4">
                    {(status === "uploading" || status === "paused") && (
                      <div className="flex items-center justify-between">
                        <span className={cn(
                          "text-sm font-medium",
                          status === "paused" ? "text-[#fbbf24]" : "text-[#6c8eff]"
                        )}>
                          {status === "paused" ? "Paused Upload" : "Uploading"}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      {status === "uploading" && (
                        <div className={cn(
                          "flex items-center justify-between gap-2",
                          "bg-[#13161e] border border-[#252a38] rounded-xl p-3"
                        )}>
                          <span className="text-sm text-[#e8eaf0] flex-1 truncate">
                            {currentFileNameRef.current || "Uploading..."}
                          </span>
                          <span className="text-sm text-[#6b7280] flex-shrink-0">{progress}%</span>
                        </div>
                      )}
                      {status === "paused" && (
                        <div className={cn(
                          "flex items-center justify-between gap-2",
                          "bg-[#13161e] border border-[#252a38] rounded-xl p-3"
                        )}>
                          <span className="text-sm text-[#e8eaf0] flex-1 truncate">
                            {currentFileNameRef.current || "Paused"}
                          </span>
                          <span className="text-sm text-[#6b7280] flex-shrink-0">Paused</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {visiblePendingFiles.length > 0 && (
                  <div className="mt-4">
                    <button
                      className={cn(
                        "w-full text-center justify-center flex items-center gap-2",
                        "rounded-lg border px-4 py-2 text-sm font-medium transition",
                        "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                      )}
                      onClick={() => setShowPending(!showPending)}
                    >
                      {showPending ? "Hide pending uploads" : `Show pending uploads (${visiblePendingFiles.length})`}
                    </button>
                    {showPending && (
                      <div className="mt-4 flex flex-col gap-3">
                        {visiblePendingFiles.map((pf) => (
                          <div key={pf._id} className={cn(
                            "flex items-center gap-3",
                            "bg-[#13161e] border border-[#252a38] rounded-xl p-3"
                          )}>
                            <span className="text-sm text-[#e8eaf0] flex-1 truncate">{pf.filename}</span>
                            <span className="text-xs text-[#6b7280] flex-shrink-0">{formatBytes(pf.size)}</span>
                            <button
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                                "border-green-600/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-50"
                              )}
                              disabled={resumingId === pf._id}
                              onClick={async () => {
                                const savedFile = resumeFileCache.get(pf._id) || resumeFileCache.get(`${pf.filename}|${pf.size}`)
                                if (savedFile) {
                                  await startResumeUpload(pf, savedFile, fileHandleRef.current ?? undefined)
                                  return
                                }
                                const pickResult = await getFileForResume()
                                if (!pickResult) return
                                const refHandle = fileHandleRef.current
                                if (refHandle) {
                                  try {
                                    const opts = { mode: "read" as const }
                                    if (await refHandle.queryPermission(opts) !== "granted") { await refHandle.requestPermission(opts) }
                                    const file = await refHandle.getFile()
                                    await startResumeUpload(pf, file, refHandle)
                                    return
                                  } catch { }
                                }
                                const cachedHandle = resumeHandleCache.get(pf._id);
                                if (cachedHandle) {
                                  try {
                                    const opts = { mode: "read" as const }
                                    if (await cachedHandle.queryPermission(opts) !== "granted") { await cachedHandle.requestPermission(opts) }
                                    const file = await cachedHandle.getFile()
                                    await startResumeUpload(pf, file, cachedHandle)
                                    return
                                  } catch { }
                                }
                                const fromDB = await getFile(pf._id);
                                if (fromDB) {
                                  resumeHandleCache.set(pf._id, fromDB.handle)
                                  try {
                                    const opts = { mode: "read" as const }
                                    if (await fromDB.handle.queryPermission(opts) !== "granted") { await fromDB.handle.requestPermission(opts) }
                                    const file = await fromDB.handle.getFile()
                                    await startResumeUpload(pf, file, fromDB.handle)
                                    return
                                  } catch { }
                                }
                                const identityKey = `${pf.filename}|${pf.size}`
                                const byIdentity = await getFile(identityKey)
                                if (byIdentity) {
                                  resumeHandleCache.set(identityKey, byIdentity.handle)
                                  try {
                                    const opts = { mode: "read" as const }
                                    if (await byIdentity.handle.queryPermission(opts) !== "granted") { await byIdentity.handle.requestPermission(opts) }
                                    const file = await byIdentity.handle.getFile()
                                    await startResumeUpload(pf, file, byIdentity.handle)
                                    return
                                  } catch { }
                                }
                                if (pickResult.handle) {
                                  resumeHandleCache.set(pf._id, pickResult.handle)
                                }
                                await startResumeUpload(pf, pickResult.file, pickResult.handle)
                              }}>
                              {resumingId === pf._id ? "Resuming..." : "Resume"}
                            </button>
                            <button
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                                "border-red-600/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                              )}
                              onClick={() => {
                                pausedFileRef.current = null
                                cancelledIds.current.add(pf._id)
                                setToast({ msg: `Cancelled "${pf.filename}"`, type: "success" })
                                fetch("/api/files/telegram/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: pf._id }) }).then(() => queryClient.invalidateQueries({ queryKey: ["dashboard"] })).catch(() => {})
                                setStatus("idle")
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {foldersLoading ? (
                <div className="flex flex-col gap-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-10 bg-[#1a1e28] rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : visibleFolders.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-[#e8eaf0]">Folders</h2>
                    <span className="text-xs bg-[#1a1e28] border border-[#252a38] text-[#6b7280] px-2 py-1 rounded-full">
                      {visibleFolders.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                    {visibleFolders.map((folder) => (
                      <div
                        key={folder._id}
                        onClick={() => setCurrentFolderId(folder._id)}
                        onContextMenu={(e) => openCtx(e, folder, "folder")}
                        className={cn(
                          "flex flex-col gap-2 p-4 rounded-xl border transition-all duration-150 cursor-pointer",
                          "border-[#252a38] bg-[#13161e] hover:border-[#fbbf24]/30 hover:transform hover:-translate-y-1"
                        )}
                      >
                        <button
                          className={cn(
                            "absolute top-2 right-2 rounded-md p-1 text-gray-400 hover:text-white hover:bg-[#252a38]",
                            "opacity-0 group-hover:opacity-100 transition-opacity"
                          )}
                          onClick={(e) => { e.stopPropagation(); openCtx(e, folder, "folder"); }}
                        >
                          ...
                        </button>
                        <div className="text-2xl">📁</div>
                        <div className="text-sm font-medium text-[#e8eaf0] truncate">{folder.name}</div>
                        <div className="text-xs text-[#6b7280]">{uploadedFiles.filter((f) => f.folderId === folder._id).length} files</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-[#e8eaf0]">Files</h2>
                  {!filesLoading && (
                    <span className="text-xs bg-[#1a1e28] border border-[#252a38] text-[#6b7280] px-2 py-1 rounded-full">
                      {visibleFiles.length}
                    </span>
                  )}
                </div>
                {filesLoading ? (
                  <div className="flex flex-col gap-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-10 bg-[#1a1e28] rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : visibleFiles.length === 0 ? (
                  <div className="text-center py-12 text-[#6b7280]">
                    <div className="text-2xl mb-4 opacity-40">📂</div>
                    <div>{currentFolder ? "No files in this folder yet" : "No files uploaded yet"}</div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {visibleFiles.map((file) => (
                      <div
                        key={file._id}
                        onContextMenu={(e) => openCtx(e, file, "file")}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-xl border transition-all duration-150",
                          "border-[#252a38] bg-[#13161e] hover:border-[#252a3880]"
                        )}
                      >
                        <div className="text-lg flex-shrink-0">
                          {getFileIcon(file.mimetype)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#e8eaf0] truncate">{file.filename}</div>
                          <div className="text-xs text-[#6b7280] truncate">
                            {formatBytes(file.size)} - {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {file.folderId && folders.find(f => f._id === file.folderId) && (
                              <span className="text-xs text-[#fbbf24] ml-1">
                                [FOLDER] {folders.find(f => f._id === file.folderId)?.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                              "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                            )}
                            onClick={async () => { await openFile(file); }}
                          >
                            Open
                          </button>
                          <button
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                              "border-green-600/30 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            )}
                            onClick={() => openShareModal(file)}
                          >
                            Share
                          </button>
                          <div className="relative">
                            <button
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                                openMenuId === file._id
                                  ? "border-[#353c52] text-[#e8eaf0] bg-[#1a1e28]"
                                  : "border-[#252a38] text-[#6b7280] bg-[#13161e] hover:bg-[#1a1e28]"
                              )}
                              onClick={(e) => {
                                if (openMenuId === file._id) {
                                  setOpenMenuId(null);
                                  setMenuPos(null);
                                } else {
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  const menuWidth = 170;
                                  let left = rect.right - menuWidth;
                                  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - 8 - menuWidth;
                                  if (left < 8) left = 8;
                                  const menuHeight = 260;
                                  let top = rect.bottom + 6;
                                  if (top + menuHeight > window.innerHeight) {
                                    top = rect.top - 6 - menuHeight;
                                    if (top < 8) top = 8;
                                  }
                                  setMenuPos({ top, left });
                                  setOpenMenuId(file._id);
                                }
                              }}
                            >
                              ...
                            </button>
                            {openMenuId === file._id && menuPos && (
                              <div
                                className={cn(
                                  "fixed z-[1000] min-w-[160px] animate-[ctxIn_0.12s_ease] rounded-[12px]",
                                  "border border-[#252a38] bg-[#1a1e28] p-2",
                                  "shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
                                )}
                                style={{ left: menuPos.left, top: menuPos.top }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                                  )}
                                  onClick={() => { openVersions(file); setOpenMenuId(null); setMenuPos(null); }}
                                >
                                  📋 Version history
                                </button>
                                <button
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                                  )}
                                  onClick={() => { downloadFile(file); setOpenMenuId(null); setMenuPos(null); }}
                                >
                                  ⬇️ Download
                                </button>
                                <button
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                                  )}
                                  onClick={() => { setMoveTarget(file); setOpenMenuId(null); setMenuPos(null); }}
                                >
                                  📁 Move to folder
                                </button>
                                <div className="h-px bg-[#252a38] my-1" />
                                <button
                                  className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                                    "text-[#f87171] transition-all duration-100 hover:bg-[#13161e] hover:text-[#f87171]"
                                  )}
                                  onClick={() => { setDeleteTarget({ type: "file", item: file }); setOpenMenuId(null); setMenuPos(null); }}
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-4 sticky top-24">
                <div className="text-sm text-[#e8eaf0] mb-2">Duplicate protection</div>
                <div className="text-2xl font-semibold text-[#fbbf24]">{uploadedFiles.length} files watched</div>
              </div>
              <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-4">
                <div className="text-sm text-[#e8eaf0] mb-2">Visible versioning</div>
                <div className="text-sm text-[#6b7280]">Open any file's Versions button</div>
              </div>
              <div className="bg-[#1a1e28] border border-[#252a38] rounded-xl p-4">
                <div className="text-sm text-[#e8eaf0] mb-2">Expiring folder links</div>
                <div className="text-sm text-[#6b7280]">Read or add access, 1-30 days</div>
              </div>
            </div>
          </div>
        </div>

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
                  onClick={() => { openFile(ctxMenu.item as FileType); setCtxMenu(null); }}
                >
                  Open
                </button>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                  )}
                  onClick={() => { openShareModal(ctxMenu.item as FileType); setCtxMenu(null); }}
                >
                  Share
                </button>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                  )}
                  onClick={() => { downloadFile(ctxMenu.item as FileType); setCtxMenu(null); }}
                >
                  Download
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
                <div className="h-px bg-[#252a38] my-1" />
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#f87171] transition-all duration-100 hover:bg-[#13161e] hover:text-[#f87171]"
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
                  onClick={() => { setCurrentFolderId((ctxMenu.item as FolderType)._id); setCtxMenu(null); }}
                >
                  Open folder
                </button>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                  )}
                  onClick={() => { openFolderShareModal(ctxMenu.item as FolderType, "read"); setCtxMenu(null); }}
                >
                  Share read link
                </button>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                  )}
                  onClick={() => { openFolderShareModal(ctxMenu.item as FolderType, "add"); setCtxMenu(null); }}
                >
                  Share write link
                </button>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                  )}
                  onClick={() => { setMoveFolderTarget(ctxMenu.item as FolderType); setCtxMenu(null); }}
                >
                  Move folder
                </button>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#9ca3af] transition-all duration-100 hover:bg-[#13161e] hover:text-[#e8eaf0]"
                  )}
                  onClick={() => { downloadFolder(ctxMenu.item as FolderType); setCtxMenu(null); }}
                >
                  Download as ZIP
                </button>
                <div className="h-px bg-[#252a38] my-1" />
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-2 text-left text-[0.82rem]",
                    "text-[#f87171] transition-all duration-100 hover:bg-[#13161e] hover:text-[#f87171]"
                  )}
                  onClick={() => { setDeleteTarget({ type: "folder", item: ctxMenu.item as FolderType }); setCtxMenu(null); }}
                >
                  Delete folder
                </button>
              </>
            )}
          </div>
        )}

        {shareTarget && (
          <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setShareTarget(null)}>
            <div
              className={cn(
                "bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm",
                "animate-[slideUp_0.2s_ease]"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-[#e8eaf0] mb-2">Share {shareTarget.type}</h3>
              <p className="text-sm text-[#6b7280] mb-4">
                {shareTarget.type === "file"
                  ? <>Anyone with the link can view <span>{shareTarget.item.filename}</span></>
                  : <>Folder link for <span>{shareTarget.item.name}</span> ({sharePermission === "add" ? "write access" : "read only"})</>}
              </p>
              {shareTarget.type === "folder" && (
                <div className="mb-4">
                  <div className="flex gap-2 mb-2">
                    <button
                      className={cn(
                        "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                        sharePermission === "read"
                          ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                          : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                      )}
                      onClick={() => { setSharePermission("read"); openFolderShareModal(shareTarget.item, "read"); }}
                    >
                      Read only
                    </button>
                    <button
                      className={cn(
                        "flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                        sharePermission === "add"
                          ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                          : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                      )}
                      onClick={() => { setSharePermission("add"); openFolderShareModal(shareTarget.item, "add"); }}
                    >
                      Write access
                    </button>
                  </div>
                  <input
                    className={cn(
                      "w-full bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-[#6b7280]",
                      "outline-none focus:border-[#6c8eff]/50"
                    )}
                    type="number"
                    min={1}
                    max={30}
                    value={shareExpiresInDays}
                    onChange={(e) => setShareExpiresInDays(Number(e.target.value))}
                    onBlur={refreshFolderShare}
                  />
                </div>
              )}
              {shareUrl ? (
                <div className="flex gap-2">
                  <input
                    className={cn(
                      "flex-1 bg-[#13161e] border border-[#252a38] rounded-lg px-3 py-2 text-xs text-[#6b7280]",
                      "truncate outline-none"
                    )}
                    readOnly
                    value={shareUrl}
                  />
                  <button
                    className={cn(
                      "px-3 py-2 text-xs font-medium rounded-lg transition",
                      shareCopied
                        ? "bg-green-500/20 border border-green-500/30 text-green-400"
                        : "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                    )}
                    onClick={copyShareUrl}
                  >
                    {shareCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : (
                <div className="text-xs text-[#6b7280]">Generating link...</div>
              )}
              <div className="flex gap-2 mt-6">
                <button
                  className={cn(
                    "flex-1 px-4 py-2 text-sm font-medium rounded-lg",
                    "border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
                  )}
                  onClick={() => setShareTarget(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {moveTarget && (
          <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setMoveTarget(null)}>
            <div className={cn("bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm", "animate-[slideUp_0.2s_ease]")} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#e8eaf0] mb-2">Move file</h3>
              <p className="text-sm text-[#6b7280] mb-4">Choose a destination for <span>{moveTarget.filename}</span></p>
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                <button
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                    moveTarget.folderId === null
                      ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                      : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                  )}
                  onClick={() => moveFile(moveTarget, null)}
                >
                  Root (no folder)
                </button>
                {moveTarget.folderId === null && (
                  <div className="grid grid-cols-[1fr_auto] gap-2 mt-2">
                    <input
                      className={cn(
                        "bg-[#13161e] border border-[#6c8eff] rounded-lg px-3 py-1.5 text-sm text-[#e8eaf0]",
                        "outline-none"
                      )}
                      placeholder="Create folder in root"
                      value={moveNewFolderName}
                      onChange={(e) => setMoveNewFolderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") createFolderAndMoveFile(); }}
                    />
                    <button
                      className={cn(
                        "px-2.5 py-1.5 text-xs font-medium rounded-lg",
                        "border border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff] hover:bg-[#6c8eff25]"
                      )}
                      onClick={createFolderAndMoveFile}
                    >
                      Create & move
                    </button>
                  </div>
                )}
                {folders.map((folder) => (
                  <button
                    key={folder._id}
                    className={cn(
                      "flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                      moveTarget.folderId === folder._id
                        ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                        : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                    )}
                    onClick={() => moveFile(moveTarget, folder._id)}
                  >
                    {folder.name}
                    <span className="text-xs text-[#6b7280] ml-auto">
                      {uploadedFiles.filter(f => f.folderId === folder._id).length}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className={cn(
                  "mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg",
                  "border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
                )}
                onClick={() => setMoveTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {moveFolderTarget && (
          <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setMoveFolderTarget(null)}>
            <div className={cn("bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm", "animate-[slideUp_0.2s_ease]")} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#e8eaf0] mb-2">Move folder</h3>
              <p className="text-sm text-[#6b7280] mb-4">Choose a destination for <span>{moveFolderTarget.name}</span></p>
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                <button
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                    (moveFolderTarget.parent_id ?? null) === null
                      ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                      : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                  )}
                  onClick={() => moveFolder(moveFolderTarget, null)}
                >
                  Root
                </button>
                {folders
                  .filter((folder) => folder._id !== moveFolderTarget._id)
                  .map((folder) => (
                    <button
                      key={folder._id}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                        moveFolderTarget.parent_id === folder._id
                          ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                          : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                      )}
                      onClick={() => moveFolder(moveFolderTarget, folder._id)}
                    >
                      {folder.name}
                    </button>
                  ))}
              </div>
              <button
                className={cn(
                  "mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg",
                  "border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
                )}
                onClick={() => setMoveFolderTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {versionTarget && (
          <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setVersionTarget(null)}>
            <div className={cn("bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm", "animate-[slideUp_0.2s_ease]")} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#e8eaf0] mb-2">Version history</h3>
              <p className="text-sm text-[#6b7280] mb-4">Every saved version of <span>{versionTarget.filename}</span> is visible here.</p>
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
                {versionsLoading ? (
                  <div className="text-xs text-[#6b7280] py-4">Loading versions...</div>
                ) : versions.length === 0 ? (
                  <div className="text-xs text-[#6b7280] py-4">No versions recorded yet.</div>
                ) : (
                  versions.map((version) => (
                    <button
                      key={version.id}
                      className={cn(
                        "flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition",
                        version.isCurrent
                          ? "border-[#6c8eff]/30 bg-[#6c8eff1a] text-[#6c8eff]"
                          : "border-gray-600 bg-transparent text-gray-400 hover:bg-gray-800"
                      )}
                      onClick={() => openVersionUrl(version)}
                    >
                      v{version.version}
                      <span className="text-xs text-[#6b7280] ml-auto">
                        {version.isCurrent ? "Current" : new Date(version.uploadedAt).toLocaleDateString()}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button
                className={cn(
                  "mt-4 w-full px-4 py-2 text-sm font-medium rounded-lg",
                  "border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
                )}
                onClick={() => setVersionTarget(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 animate-[fadeIn_0.15s_ease]" onClick={() => setDeleteTarget(null)}>
            <div className={cn("bg-[#1a1e28] border border-[#252a38] rounded-xl p-6 w-full max-w-sm", "animate-[slideUp_0.2s_ease]")} onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-[#e8eaf0] mb-2">Confirm delete</h3>
              <p className="text-sm text-[#6b7280] mb-6">
                {deleteTarget.type === "file"
                  ? `Delete "${(deleteTarget.item as FileType).filename}"? This cannot be undone.`
                  : `Delete folder "${deleteTarget.item.name}" and all its contents? This cannot be undone.`}
              </p>
              <div className="flex gap-2">
                <button
                  className={cn(
                    "flex-1 px-4 py-2 text-sm font-medium rounded-lg",
                    "border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white"
                  )}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className={cn(
                    "flex-1 px-4 py-2 text-sm font-medium rounded-lg",
                    "border border-red-600/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                  )}
                  onClick={confirmDelete}
                >
                  Delete
                </button>
              </div>
            </div>
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
    </>
  );
}