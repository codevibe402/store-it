"use client";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {useReducer} from "react"
import FileSearch from "./filesearch";
import { storeFile, getFile, removeFile } from "@/lib/indexedDB";
// -- In-memory file cache for resume (same-session only) --
const resumeFileMap = new Map<string, FileSystemFileHandle>();

// -- Constants --
const SMALL_FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;
const TELEGRAM_CHUNK_SIZE = 4 * 1024 * 1024;
const TELEGRAM_CONCURRENCY = 6;

// -- Types --
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
type uploadstate={
  status:UploadStatus
  progress: number
  error: string
   duplicateFile: FileType | null
}
const initialState:uploadstate ={
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

// -- Utils --
async function getFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("Upload cancelled"), { isCancelled: true }));
      return;
    }

    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(Object.assign(new Error("Upload cancelled"), { isCancelled: true }));
      },
      { once: true },
    );
  });
}

function isAbortLike(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
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
type UploadAction= 
    | { type: "UPLOAD_START" }
    | { type: "UPLOAD_PROGRESS"; progress: number }
    | { type: "UPLOAD_SUCCESS" }
    | { type: "UPLOAD_ERROR"; message: string };
function reducer(state: uploadstate,action: UploadAction):uploadstate{
  switch(action.type){
    case "UPLOAD_START":
      return {...state}
    case "UPLOAD_PROGRESS":
      return {...state, progress: action.progress}
    case "UPLOAD_SUCCESS":
      return {...state, status: "success"} 
    case "UPLOAD_ERROR":
      return {...state, status: "error", error: action.message}
  }

}

// -- Component --
export default function FileUpload() {
  const [state, dispatch] = useReducer(reducer, initialState);


  const router = useRouter();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const isAuthenticated = sessionStatus === "authenticated";
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Upload state
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [duplicateFile, setDuplicateFile] = useState<FileType | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  // Folder / navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [moveNewFolderName, setMoveNewFolderName] = useState("");

  // Context menu & modals
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
  const [storageType, setStorageType] = useState<"s3" | "telegram">("telegram");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFileIdRef = useRef<string | null>(null);
  const currentUploadRef = useRef<{ backend: "s3" | "telegram"; fileId: string; uploadId?: string; key?: string } | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
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
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // -- Queries --
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

  // -- Small upload --
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

  // -- Multipart upload --
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

  async function getChunkHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
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
        throw new Error(errBody.error || "S3 fallback upload failed");
      }
      onProgress(100);
      return res.json();
    }

    const initRes = await fetch("/api/files/upload/multipart/init", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name, mimeType: file.type, size: file.size, hash, fileId,
      }),
    });
    if (!initRes.ok) {
      const errBody = await initRes.json().catch(() => ({ error: "Failed to init S3 multipart fallback" }));
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
    const totalChunks = Math.ceil(file.size / TELEGRAM_CHUNK_SIZE);

    const initRes = await fetch("/api/files/telegram/init", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name, size: file.size, hash,
        mimeType: file.type, folderId: currentFolderId,
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

    const resumeRes = await fetch(`/api/files/telegram/${fileId}/resume`);
    const resumeData = resumeRes.ok ? await resumeRes.json() : null;
    const alreadyUploaded = new Set<number>(resumeData?.uploadedIndexes ?? []);
    let uploadedBytes = resumeData?.uploadedBytes ?? 0;
    onProgress(Math.round((uploadedBytes / file.size) * 100));

    const controller = new AbortController();
    abortRef.current = controller;
    cancelRef.current = false;
    pauseRef.current = false;

    const lock = { current: 0 };

    async function worker() {
      while (!cancelRef.current && !pauseRef.current && !controller.signal.aborted) {
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
              const errBody = await res.json().catch(() => ({})) as {
                canFallbackToS3?: boolean;
                chunkIndex?: number;
              };
              const err = new Error(`Status ${res.status}`) as TelegramChunkError;
              err.canFallbackToS3 = errBody.canFallbackToS3 === true;
              err.chunkIndex = errBody.chunkIndex;
              throw err;
            }
            success = true;
            uploadedBytes += chunkBlob.size;
            onProgress(Math.round((uploadedBytes / file.size) * 100));
          } catch (err: unknown) {
            const chunkError = err as TelegramChunkError;
            if (cancelRef.current || pauseRef.current || controller.signal.aborted || isAbortLike(err) || chunkError?.isCancelled) {
              throw { isCancelled: true };
            }
            if (chunkError.canFallbackToS3) throw chunkError;
            if (attempt < 2) await abortableDelay(1000 * Math.pow(2, attempt), controller.signal);
            else throw new Error(`Chunk ${index} failed after 3 attempts`);
          }
        }
      }
    }

    const workers = Array.from({ length: TELEGRAM_CONCURRENCY }, () => worker());
    try {
      await Promise.all(workers);
    } catch (err: unknown) {
      const uploadError = err as TelegramChunkError;
      abortRef.current = null;
      cancelRef.current = true;
      controller.abort();

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
            throw new Error(fbErr.error || "Fallback to S3 failed");
          }

          onProgress(0);

          await s3FallbackUpload(file, hash, fileId, onProgress);

          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          return;
        } catch (fallbackErr: unknown) {
          const message = fallbackErr instanceof Error ? fallbackErr.message : "Unknown fallback error";
          throw new Error(`Telegram upload failed and S3 fallback also failed: ${message}`);
        }
      }

      currentFileIdRef.current = null;
      currentUploadRef.current = null;
      throw uploadError;
    }
    abortRef.current = null;
    currentFileIdRef.current = null;
    currentUploadRef.current = null;

    if (cancelRef.current || pauseRef.current) throw { isCancelled: true };

    const completeRes = await fetch("/api/files/telegram/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    if (!completeRes.ok) throw new Error("Failed to complete Telegram upload");

    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    return completeRes.json();
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

  // -- File actions --
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

  // -- Upload flow --
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
      resumeFileMap.delete(meta.fileId);
      removeFile(meta.fileId).catch(() => {});
      queryClient.setQueryData<{
        files: FileType[];
        folders: FolderType[];
        pendingFiles: FileType[];
      }>(["dashboard"], (old) => old ? {
        ...old,
        pendingFiles: old.pendingFiles.filter((file) => file._id !== meta.fileId),
      } : old);
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
      try {
        await fetch("/api/files/telegram/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: meta.fileId }),
        });
      } catch {}
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }

    setStatus("paused"); setProgress(0);
    setToast({ msg: "Upload paused. You can resume later.", type: "warn" });
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
    let identityKey: string | null = null
    if (handle) {
      identityKey = `${file.name}|${file.size}`
      resumeFileMap.set(identityKey, handle)
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
      if (handle) {
        resumeFileMap.set(fileId, handle)
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
        resumeFileMap.delete(capturedFileId)
        removeFile(capturedFileId).catch(() => {})
      }
      if (identityKey) {
        resumeFileMap.delete(identityKey)
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

  const handleResume = async (pendingFile: FileType, file: File, handle?: FileSystemFileHandle) => {
    setResumingId(pendingFile._id);
    setStatus("uploading");
    setProgress(0);
    currentFileNameRef.current = file.name;
    if (handle) {
      resumeFileMap.set(pendingFile._id, handle)
      storeFile(pendingFile._id, {
        fileId: pendingFile._id,
        handle,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        storedAt: Date.now(),
      }).catch(() => {})
    }
    cancelRef.current = false;
    pauseRef.current = false;
    try {
      const hash = await getFileHash(file);
      if (pendingFile.hash && hash !== pendingFile.hash) {
        throw new Error("Selected file does not match the original. Hash mismatch.");
      }
      await uploadSmart(file, hash, (pct) => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        setProgress(pct);
      });
      setProgress(100);
      setStatus("success");
      resumeFileMap.delete(pendingFile._id);
      removeFile(pendingFile._id).catch(() => {});
      setToast({ msg: `"${file.name}" upload resumed and completed!`, type: "success" });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err: unknown) {
      const uploadError = err as UploadError;
      if (uploadError?.isCancelled) {
        resumeFileMap.delete(pendingFile._id);
        removeFile(pendingFile._id).catch(() => {});
        return;
      }
      setStatus("error");
      setErrorMsg(uploadError?.message || "Resume failed");
      setToast({ msg: uploadError?.message || "Resume failed.", type: "error" });
    } finally {
      setResumingId(null);
    }
  };

  // -- Auto-resume on page refresh --
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
        resumeFileMap.set(pf._id, record.handle)
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
          resumeFileMap.delete(pf._id)
          return
        }
        handleResume(pf, file, record.handle)
      } catch {
        removeFile(pf._id).catch(() => {})
        resumeFileMap.delete(pf._id)
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
      } catch {
        // user cancelled or API error, fall through to hidden input
      }
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
    setCtxMenu({ x: e.clientX, y: e.clientY, item, itemType });
  };

  const currentFolder = folders.find((f) => f._id === currentFolderId);

  // -- Render --
  return (
    <>

      {showSearch && <FileSearch onClose={() => setShowSearch(false)} />}

      <div className="fu-root">

        {/* -- Top nav -- */}
        <div className="fu-topbar">
          <div className="fu-topbar-brand">Storage</div>
          <div className="fu-topbar-actions">
            <button className="fu-topbar-btn" onClick={() => setShowSearch(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </button>
            <button className="fu-topbar-btn" onClick={() => router.push("/all-files")}>
              All files
            </button>
            <button className="fu-topbar-btn accent" onClick={() => router.push("/sidebar")}>
              Browse by type
            </button>
          </div>
        </div>

        {/* -- Folder tabs -- */}
        <div className="fu-tabs-wrap">
          <button
            className={`fu-tab ${currentFolderId === null ? "active" : ""}`}
            onClick={() => setCurrentFolderId(null)}
          >
            All files
            <span className="fu-tab-count">{uploadedFiles.filter(f => f.folderId === null).length}</span>
          </button>

          {foldersLoading ? (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", padding: "0 8px" }}>Loading</span>
          ) : (
            folders.map((folder) => (
              <button
                key={folder._id}
                className={`fu-tab ${currentFolderId === folder._id ? "active" : ""}`}
                onClick={() => setCurrentFolderId(folder._id)}
                onContextMenu={(e) => openCtx(e, folder, "folder")}
              >
                {folder.name}
                <span className="fu-tab-count">{uploadedFiles.filter(f => f.folderId === folder._id).length}</span>
              </button>
            ))
          )}

          {showNewFolder ? (
            <div className="fu-new-folder-inline">
              <input
                className="fu-new-folder-input-inline"
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                autoFocus
              />
              <button className="fu-btn-pill" onClick={() => setShowNewFolder(false)}>x</button>
              <button className="fu-btn-pill accent" onClick={createFolder}>Create</button>
            </div>
          ) : (
            <button className="fu-tab-new" onClick={() => setShowNewFolder(true)}>+ New folder</button>
          )}
        </div>

        {/* -- Main content -- */}
        <div className="fu-shell">
        <div className="fu-content">

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {currentFolder && (
              <button className="fu-action-btn" onClick={() => setCurrentFolderId(currentFolder.parent_id ?? null)}>
                Back
              </button>
            )}
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontWeight: 300 }}>
              {currentFolder
                ? `${visibleFiles.length} file${visibleFiles.length !== 1 ? "s" : ""} in "${currentFolder.name}"`
                : "Drop files to upload, or browse from your device."}
            </div>
            {currentFolder && (
              <div className="fu-header-actions">
                  <button className="fu-action-btn" onClick={() => downloadFolder(currentFolder)}>
                    Download folder
                  </button>
                <button className="fu-action-btn" onClick={() => openFolderShareModal(currentFolder, "read")}>
                  Share read link
                </button>
                <button className="fu-action-btn" onClick={() => openFolderShareModal(currentFolder, "add")}>
                  Share add link
                </button>
                <button
                  className="fu-action-btn"
                  style={{ color: "var(--error)", borderColor: "rgba(248,113,113,0.25)" }}
                  onClick={() => setDeleteTarget({ type: "folder", item: currentFolder })}
                >
                  Delete folder
                </button>
              </div>
            )}
          </div>

          {/* Drop zone */}
          <div
            className={`fu-dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={handlePickFile}
          >
            <input ref={inputRef} type="file" hidden onChange={onInputChange} />
            <div className="fu-dropzone-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg></div>
            <div className="fu-dropzone-title">
              Drop your file here{currentFolder ? ` into "${currentFolder.name}"` : ""}
            </div>
            <div className="fu-dropzone-sub">
              or <span>browse</span> -- under 10 MB uploads instantly, larger files use multipart
            </div>
          </div>

          {/* Active Uploads */}
          {(status === "uploading" || status === "paused" || (!showPending && pendingFiles.length > 0)) && (
            <div>
              {(status === "uploading" || status === "paused") && (
                <div className="fu-section-header">
                  <span className="fu-section-title">{status === "paused" ? "Paused Upload" : "Uploading"}</span>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {status === "uploading" && (
                  <div className="fu-pending-row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="fu-pending-name">{currentFileNameRef.current || "Uploading..."}</span>
                      <span className="fu-pending-meta">{progress}%</span>
                    </div>
                    <div className="fu-bar-bg"><div className="fu-bar-fill" style={{ width: `${progress}%` }} /></div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button className="fu-cancel-btn" onClick={handlePause}>Pause</button>
                      <button className="fu-cancel-btn" onClick={handleCancel}>Cancel</button>
                    </div>
                  </div>
                )}
                {status === "paused" && (
                  <div className="fu-pending-row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="fu-pending-name">{currentFileNameRef.current || "Paused"}</span>
                      <span className="fu-pending-meta">Paused</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      {(() => {
                        const pf = pendingFiles.find(p => p._id === currentUploadRef.current?.fileId)
                        if (!pf) return null
                        return (
                          <>
                            <button className="fu-pending-btn resume" onClick={async () => {
                              const cachedHandle = resumeFileMap.get(pf._id);
                              if (cachedHandle) {
                                try {
                                  const opts = { mode: "read" as const }
                                  if (await cachedHandle.queryPermission(opts) !== "granted") { await cachedHandle.requestPermission(opts) }
                                  const file = await cachedHandle.getFile()
                                  await handleResume(pf, file, cachedHandle)
                                } catch { setToast({ msg: "Cannot access the original file. Please reselect it.", type: "error" }) }
                                return;
                              }
                              const fromDB = await getFile(pf._id);
                              if (fromDB) {
                                resumeFileMap.set(pf._id, fromDB.handle)
                                try {
                                  const opts = { mode: "read" as const }
                                  if (await fromDB.handle.queryPermission(opts) !== "granted") { await fromDB.handle.requestPermission(opts) }
                                  const file = await fromDB.handle.getFile()
                                  await handleResume(pf, file, fromDB.handle)
                                } catch { setToast({ msg: "Cannot access the original file. Please reselect it.", type: "error" }) }
                                return;
                              }
                              const identityKey = `${pf.filename}|${pf.size}`
                              const byIdentity = await getFile(identityKey)
                              if (byIdentity) {
                                resumeFileMap.set(identityKey, byIdentity.handle)
                                try {
                                  const opts = { mode: "read" as const }
                                  if (await byIdentity.handle.queryPermission(opts) !== "granted") { await byIdentity.handle.requestPermission(opts) }
                                  const file = await byIdentity.handle.getFile()
                                  await handleResume(pf, file, byIdentity.handle)
                                } catch { setToast({ msg: "Cannot access the original file. Please reselect it.", type: "error" }) }
                                return
                              }
                              try {
                                const [fileHandle] = await showOpenFilePicker()
                                const file = await fileHandle.getFile()
                                resumeFileMap.set(pf._id, fileHandle)
                                await handleResume(pf, file, fileHandle)
                              } catch {
                                const fileInput = document.createElement("input"); fileInput.type = "file"
                                fileInput.onchange = async () => { const f = fileInput.files?.[0]; if (f) await handleResume(pf, f) }
                                fileInput.click()
                              }
                            }}>Resume</button>
                            <button className="fu-pending-btn cancel" onClick={() => {
                              queryClient.setQueryData<{ files: FileType[]; folders: FolderType[]; pendingFiles: FileType[] }>(["dashboard"], (old) => old ? { ...old, pendingFiles: old.pendingFiles.filter((f) => f._id !== pf._id) } : old)
                              setToast({ msg: `Cancelled "${pf.filename}"`, type: "success" })
                              fetch("/api/files/telegram/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: pf._id }) }).then(() => queryClient.invalidateQueries({ queryKey: ["dashboard"] })).catch(() => {})
                              setStatus("idle")
                            }}>Cancel</button>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pending Uploads Toggle */}
          {pendingFiles.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                className="fu-action-btn"
                onClick={() => setShowPending(!showPending)}
                style={{ width: "100%", textAlign: "center", justifyContent: "center" }}
              >
                {showPending ? `Hide pending uploads` : `Show pending uploads (${pendingFiles.length})`}
              </button>
              {showPending && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {pendingFiles.map((pf) => (
                    <div key={pf._id} className="fu-pending-row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="fu-pending-name">{pf.filename}</span>
                      <span className="fu-pending-meta">{formatBytes(pf.size)}</span>
                      <button className="fu-pending-btn resume" disabled={resumingId === pf._id} onClick={async () => {
                        const cachedHandle = resumeFileMap.get(pf._id);
                        if (cachedHandle) {
                          try {
                            const opts = { mode: "read" as const }
                            if (await cachedHandle.queryPermission(opts) !== "granted") { await cachedHandle.requestPermission(opts) }
                            const file = await cachedHandle.getFile()
                            await handleResume(pf, file, cachedHandle)
                          } catch { setToast({ msg: "Cannot access the original file. Please reselect it.", type: "error" }) }
                          return;
                        }
                        const fromDB = await getFile(pf._id);
                        if (fromDB) {
                          resumeFileMap.set(pf._id, fromDB.handle)
                          try {
                            const opts = { mode: "read" as const }
                            if (await fromDB.handle.queryPermission(opts) !== "granted") { await fromDB.handle.requestPermission(opts) }
                            const file = await fromDB.handle.getFile()
                            await handleResume(pf, file, fromDB.handle)
                          } catch { setToast({ msg: "Cannot access the original file. Please reselect it.", type: "error" }) }
                          return;
                        }
                        const identityKey = `${pf.filename}|${pf.size}`
                        const byIdentity = await getFile(identityKey)
                        if (byIdentity) {
                          resumeFileMap.set(identityKey, byIdentity.handle)
                          try {
                            const opts = { mode: "read" as const }
                            if (await byIdentity.handle.queryPermission(opts) !== "granted") { await byIdentity.handle.requestPermission(opts) }
                            const file = await byIdentity.handle.getFile()
                            await handleResume(pf, file, byIdentity.handle)
                          } catch { setToast({ msg: "Cannot access the original file. Please reselect it.", type: "error" }) }
                          return
                        }
                        try {
                          const [fileHandle] = await showOpenFilePicker()
                          const file = await fileHandle.getFile()
                          resumeFileMap.set(pf._id, fileHandle)
                          await handleResume(pf, file, fileHandle)
                        } catch {
                          const fileInput = document.createElement("input"); fileInput.type = "file"
                          fileInput.onchange = async () => { const f = fileInput.files?.[0]; if (f) await handleResume(pf, f) }
                          fileInput.click()
                        }
                      }}>{resumingId === pf._id ? "Resuming..." : "Resume"}</button>
                      <button className="fu-pending-btn cancel" onClick={() => {
                        queryClient.setQueryData<{ files: FileType[]; folders: FolderType[]; pendingFiles: FileType[] }>(["dashboard"], (old) => old ? { ...old, pendingFiles: old.pendingFiles.filter((f) => f._id !== pf._id) } : old)
                        setToast({ msg: `Cancelled "${pf.filename}"`, type: "success" })
                        fetch("/api/files/telegram/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: pf._id }) }).then(() => queryClient.invalidateQueries({ queryKey: ["dashboard"] })).catch(() => {})
                      }}>Cancel</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Folders grid */}
          {!foldersLoading && visibleFolders.length > 0 && (
            <div>
              <div className="fu-section-header">
                <span className="fu-section-title">Folders</span>
                <span className="fu-section-count">{visibleFolders.length}</span>
              </div>
              <div className="fu-folder-grid">
                {visibleFolders.map((folder) => (
                  <div
                    key={folder._id}
                    className="fu-folder-card"
                    onClick={() => setCurrentFolderId(folder._id)}
                    onContextMenu={(e) => openCtx(e, folder, "folder")}
                  >
                    <button className="fu-folder-card-opts" onClick={(e) => { e.stopPropagation(); openCtx(e, folder, "folder"); }}>...</button>
                    <div className="fu-folder-icon">[FOLDER]</div>
                    <div className="fu-folder-name">{folder.name}</div>
                    <div className="fu-folder-count">{uploadedFiles.filter((f) => f.folderId === folder._id).length} files</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File list */}
          <div>
            <div className="fu-section-header">
              <span className="fu-section-title">Files</span>
              {!filesLoading && <span className="fu-section-count">{visibleFiles.length}</span>}
            </div>
            {filesLoading ? (
              <><div className="fu-skeleton" /><div className="fu-skeleton" /><div className="fu-skeleton" /></>
            ) : visibleFiles.length === 0 ? (
              <div className="fu-empty">
                <div className="fu-empty-icon">[DIR]</div>
                <div>{currentFolder ? "No files in this folder yet" : "No files uploaded yet"}</div>
              </div>
            ) : (
              visibleFiles.map((file) => (
                <div key={file._id} className="fu-file-card" onContextMenu={(e) => openCtx(e, file, "file")}>
                  <div className="fu-file-icon">{getFileIcon(file.mimetype)}</div>
                  <div className="fu-file-info">
                    <div className="fu-file-name">{file.filename}</div>
                    <div className="fu-file-meta">
                      {formatBytes(file.size)} - {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {file.folderId && folders.find(f => f._id === file.folderId) && (
                        <span style={{ marginLeft: 6, color: "var(--folder-color)", fontSize: "0.68rem" }}>
                          [FOLDER] {folders.find(f => f._id === file.folderId)?.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="fu-file-actions">
                    <button className="fu-icon-btn open"
                      onClick={async () => openFile(file)}>
                      Open
                    </button>
                    <button className="fu-icon-btn share" onClick={() => openShareModal(file)}>Share</button>
                    <button className="fu-icon-btn" onClick={() => openVersions(file)}>Versions</button>
                    <button className="fu-icon-btn" onClick={() => downloadFile(file)}>Download</button>

                    {/* Three-dot menu */}
                    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="fu-icon-btn"
                        style={openMenuId === file._id ? { borderColor: "var(--border-hover)", color: "var(--text)" } : {}}
                        onClick={() => setOpenMenuId(openMenuId === file._id ? null : file._id)}
                      >
                        ...
                      </button>

                      {openMenuId === file._id && (
                        <div style={{
                          position: "absolute", right: 0, top: "calc(100% + 6px)",
                          background: "var(--surface2)", border: "1px solid var(--border)",
                          borderRadius: "12px", padding: "5px", minWidth: "170px",
                          zIndex: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                        }}>
                          <button className="fu-ctx-item"
                            onClick={async () => { await openFile(file); setOpenMenuId(null); }}>
                            Open
                          </button>
                          <button className="fu-ctx-item"
                            onClick={() => { openShareModal(file); setOpenMenuId(null); }}>
                            Share
                          </button>
                          <button className="fu-ctx-item"
                            onClick={() => { openVersions(file); setOpenMenuId(null); }}>
                            Version history
                          </button>
                          <button className="fu-ctx-item"
                            onClick={() => { downloadFile(file); setOpenMenuId(null); }}>
                    Download
                          </button>
                          <button className="fu-ctx-item"
                            onClick={() => { setMoveTarget(file); setOpenMenuId(null); }}>
                            Move to folder
                          </button>
                          <div className="fu-ctx-sep" />
                          <button className="fu-ctx-item danger"
                            onClick={() => { setDeleteTarget({ type: "file", item: file }); setOpenMenuId(null); }}>
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

        </div>
        <aside className="fu-insights">
          <div className="fu-trust-card">
            <div className="fu-trust-label">Duplicate protection</div>
            <div className="fu-trust-value">{uploadedFiles.length} files watched</div>
          </div>
          <div className="fu-trust-card">
            <div className="fu-trust-label">Visible versioning</div>
            <div className="fu-trust-value">Open any file&apos;s Versions button</div>
          </div>
          <div className="fu-trust-card">
            <div className="fu-trust-label">Expiring folder links</div>
            <div className="fu-trust-value">Read or add access, 1-30 days</div>
          </div>
        </aside>
        </div>
      </div>

      {/* -- Context menu -- */}
      {ctxMenu && (
        <div className="fu-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          {ctxMenu.itemType === "file" ? (
            <>
              <button className="fu-ctx-item" onClick={async () => { await openFile(ctxMenu.item as FileType); setCtxMenu(null); }}>Open</button>
              <button className="fu-ctx-item" onClick={() => { openShareModal(ctxMenu.item as FileType); setCtxMenu(null); }}>Share</button>
              <button className="fu-ctx-item" onClick={() => { downloadFile(ctxMenu.item as FileType); setCtxMenu(null); }}>Download</button>
              <button className="fu-ctx-item" onClick={() => { setMoveTarget(ctxMenu.item as FileType); setCtxMenu(null); }}>Move to folder</button>
              <div className="fu-ctx-sep" />
              <button className="fu-ctx-item danger" onClick={() => { setDeleteTarget({ type: "file", item: ctxMenu.item as FileType }); setCtxMenu(null); }}>Delete</button>
            </>
          ) : (
            <>
              <button className="fu-ctx-item" onClick={() => { setCurrentFolderId((ctxMenu.item as FolderType)._id); setCtxMenu(null); }}>Open folder</button>
              <button className="fu-ctx-item" onClick={() => { openFolderShareModal(ctxMenu.item as FolderType, "read"); setCtxMenu(null); }}>Share read link</button>
              <button className="fu-ctx-item" onClick={() => { openFolderShareModal(ctxMenu.item as FolderType, "add"); setCtxMenu(null); }}>Share write link</button>
              <button className="fu-ctx-item" onClick={() => { setMoveFolderTarget(ctxMenu.item as FolderType); setCtxMenu(null); }}>Move folder</button>
              <button className="fu-ctx-item" onClick={() => { downloadFolder(ctxMenu.item as FolderType); setCtxMenu(null); }}>Download as ZIP</button>
              <div className="fu-ctx-sep" />
              <button className="fu-ctx-item danger" onClick={() => { setDeleteTarget({ type: "folder", item: ctxMenu.item as FolderType }); setCtxMenu(null); }}>Delete folder</button>
            </>
          )}
        </div>
      )}

      {/* -- Share modal -- */}
      {shareTarget && (
        <div className="fu-overlay" onClick={() => setShareTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">Share {shareTarget.type}</div>
            <div className="fu-modal-sub">
              {shareTarget.type === "file"
                ? <>Anyone with the link can view <span>{shareTarget.item.filename}</span></>
                : <>Folder link for <span>{shareTarget.item.name}</span> ({sharePermission === "add" ? "write access" : "read only"})</>}
            </div>
            {shareTarget.type === "folder" && (
              <div className="fu-folder-picker" style={{ marginBottom: 12 }}>
                <button className={`fu-picker-item ${sharePermission === "read" ? "active" : ""}`} onClick={() => { setSharePermission("read"); openFolderShareModal(shareTarget.item, "read"); }}>
                  Read only
                </button>
                <button className={`fu-picker-item ${sharePermission === "add" ? "active" : ""}`} onClick={() => { setSharePermission("add"); openFolderShareModal(shareTarget.item, "add"); }}>
                  Write access
                </button>
                <input
                  className="fu-share-url"
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 9, width: "100%" }}
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
              <div className="fu-share-url-wrap">
                <input className="fu-share-url" readOnly value={shareUrl} />
                <button className={`fu-copy-btn ${shareCopied ? "copied" : ""}`} onClick={copyShareUrl}>
                  {shareCopied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Generating link...</div>
            )}
            <div className="fu-modal-actions">
              <button className="fu-modal-btn secondary" onClick={() => setShareTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* -- Move modal -- */}
      {moveTarget && (
        <div className="fu-overlay" onClick={() => setMoveTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">Move file</div>
            <div className="fu-modal-sub">Choose a destination for <span>{moveTarget.filename}</span></div>
            <div className="fu-folder-picker">
              <button className={`fu-picker-item ${moveTarget.folderId === null ? "active" : ""}`} onClick={() => moveFile(moveTarget, null)}>
                Root (no folder)
              </button>
              {moveTarget.folderId === null && (
                <div className="fu-move-create">
                  <input
                    value={moveNewFolderName}
                    onChange={(e) => setMoveNewFolderName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") createFolderAndMoveFile(); }}
                    placeholder="Create folder in root"
                  />
                  <button onClick={createFolderAndMoveFile}>Create & move</button>
                </div>
              )}
              {folders.map((folder) => (
                <button
                  key={folder._id}
                  className={`fu-picker-item ${moveTarget.folderId === folder._id ? "active" : ""}`}
                  onClick={() => moveFile(moveTarget, folder._id)}
                >
                  {folder.name}
                  <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    {uploadedFiles.filter(f => f.folderId === folder._id).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="fu-modal-actions">
              <button className="fu-modal-btn secondary" onClick={() => setMoveTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {moveFolderTarget && (
        <div className="fu-overlay" onClick={() => setMoveFolderTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">Move folder</div>
            <div className="fu-modal-sub">Choose a destination for <span>{moveFolderTarget.name}</span></div>
            <div className="fu-folder-picker">
              <button
                className={`fu-picker-item ${(moveFolderTarget.parent_id ?? null) === null ? "active" : ""}`}
                onClick={() => moveFolder(moveFolderTarget, null)}
              >
                Root
              </button>
              {folders
                .filter((folder) => folder._id !== moveFolderTarget._id)
                .map((folder) => (
                  <button
                    key={folder._id}
                    className={`fu-picker-item ${moveFolderTarget.parent_id === folder._id ? "active" : ""}`}
                    onClick={() => moveFolder(moveFolderTarget, folder._id)}
                  >
                    {folder.name}
                  </button>
                ))}
            </div>
            <div className="fu-modal-actions">
              <button className="fu-modal-btn secondary" onClick={() => setMoveFolderTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* -- Version history modal -- */}
      {versionTarget && (
        <div className="fu-overlay" onClick={() => setVersionTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">Version history</div>
            <div className="fu-modal-sub">Every saved version of <span>{versionTarget.filename}</span> is visible here.</div>
            <div className="fu-folder-picker">
              {versionsLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading versions...</div>
              ) : versions.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>No versions recorded yet.</div>
              ) : (
                versions.map((version) => (
                  <button className={`fu-picker-item ${version.isCurrent ? "active" : ""}`} key={version.id} onClick={() => openVersionUrl(version)}>
                    v{version.version}
                    <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      {version.isCurrent ? "Current" : new Date(version.uploadedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="fu-modal-actions">
              <button className="fu-modal-btn secondary" onClick={() => setVersionTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* -- Delete confirm modal -- */}
      {deleteTarget && (
        <div className="fu-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">Confirm delete</div>
            <div className="fu-modal-sub">
              {deleteTarget.type === "file"
                ? `Delete "${(deleteTarget.item as FileType).filename}"? This cannot be undone.`
                : `Delete folder "${deleteTarget.item.name}" and all its contents? This cannot be undone.`}
            </div>
            <div className="fu-modal-actions">
              <button className="fu-modal-btn secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="fu-modal-btn danger" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* -- Toast -- */}
      {toast && (
        <div className={`fu-toast ${toast.type}`}>
          {toast.type === "success" ? "+" : toast.type === "warn" ? "!" : "x"} {toast.msg}
        </div>
      )}
    </>
  );
}
