"use client";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {useReducer} from "react"
// ── Constants ────────────────────────────────────────────────────────────────
const SMALL_FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;
const TELEGRAM_CHUNK_SIZE = 4 * 1024 * 1024;
const TELEGRAM_CONCURRENCY = 6;

// ── Types ─────────────────────────────────────────────────────────────────────
type UploadStatus = "idle" | "uploading" | "success" | "error" | "duplicate";

type FileType = {
  _id: string;
  filename: string;
  mimetype: string;
  size: number;
  hash?: string;
  storageUrl: string;
  owner_id: string;
  status: "pending" | "uploaded";
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
type SearchResult = FileType & { matchedContent?: boolean; snippet?: string };
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

// ── Utils ─────────────────────────────────────────────────────────────────────
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

function getFileIcon(mimetype: string): string {
  if (mimetype.startsWith("image/")) return "🖼️";
  if (mimetype.startsWith("video/")) return "🎬";
  if (mimetype.startsWith("audio/")) return "🎵";
  if (mimetype.includes("pdf")) return "📄";
  if (mimetype.includes("zip") || mimetype.includes("compressed")) return "🗜️";
  if (mimetype.includes("word") || mimetype.includes("document")) return "📝";
  if (mimetype.includes("sheet") || mimetype.includes("excel")) return "📊";
  return "📁";
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

// ── Component ─────────────────────────────────────────────────────────────────
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [versionTarget, setVersionTarget] = useState<FileType | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const [storageType, setStorageType] = useState<"s3" | "telegram">("telegram");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentFileIdRef = useRef<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!isAuthenticated || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setSearchResults(data.results ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setSearchResults([]);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isAuthenticated, searchQuery]);
  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data: files = [], isLoading: filesLoading } = useQuery<FileType[]>({
    queryKey: ["files"],
    queryFn: async () => {
      const res = await fetch("/api/files/fetch");
      if (!res.ok) throw new Error("Failed to fetch files");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const { data: folders = [], isLoading: foldersLoading } = useQuery<FolderType[]>({
    queryKey: ["folders"],
    queryFn: async () => {
      const res = await fetch("/api/folders");
      if (!res.ok) throw new Error("Failed to fetch folders");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const { data: pendingFiles = [], isLoading: pendingLoading } = useQuery<FileType[]>({
    queryKey: ["pending-files"],
    queryFn: async () => {
      const res = await fetch("/api/files/fetch?status=pending");
      if (!res.ok) throw new Error("Failed to fetch pending files");
      return res.json();
    },
    enabled: isAuthenticated,
    refetchInterval: 15000,
  });

  const uploadedFiles = files.filter((f) => f.status === "uploaded");
  const visibleFiles = uploadedFiles.filter((f) => f.folderId === currentFolderId);
  const visibleFolders = folders.filter((folder) => (folder.parent_id ?? null) === currentFolderId);

  async function parseError(res: Response, fallback: string) {
    const data = await res.json().catch(() => ({}));
    return new Error(data.error || fallback);
  }

  // ── Small upload ──────────────────────────────────────────────────────────────
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["files"] }),
  });

  // ── Multipart upload ──────────────────────────────────────────────────────────
  async function multipartUpload(file: File, hash: string, onProgress: (pct: number) => void) {
    const initRes = await fetch("/api/files/upload/multipart/init", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, folderId: currentFolderId, hash }),
    });
    if (cancelRef.current) throw { isCancelled: true };
    if (initRes.status === 409) { const d = await initRes.json(); throw { isDuplicate: true, existingFile: d.existingFile }; }
    if (!initRes.ok) throw await parseError(initRes, "Failed to initialise multipart upload");
    const { uploadId, key, totalParts, fileId } = await initRes.json();
    const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);
    const presignRes = await fetch("/api/files/upload/multipart/presign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, uploadId, partNumbers }),
    });
    if (cancelRef.current) throw { isCancelled: true };
    if (!presignRes.ok) throw new Error("Failed to get presigned URLs");
    const { urls } = await presignRes.json();
    let uploadedBytes = 0;
    const parts = await Promise.all(urls.map(async (url: string, i: number) => {
      if (cancelRef.current) throw { isCancelled: true };
      const start = i * CHUNK_SIZE;
      const chunk = file.slice(start, start + CHUNK_SIZE);
      const res = await fetch(url, { method: "PUT", body: chunk });
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
    queryClient.invalidateQueries({ queryKey: ["files"] });
    return completeRes.json();
  }

  async function getChunkHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function telegramUpload(file: File, hash: string, onProgress: (pct: number) => void) {
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

    const resumeRes = await fetch(`/api/files/telegram/${fileId}/resume`);
    const resumeData = resumeRes.ok ? await resumeRes.json() : null;
    const alreadyUploaded = new Set<number>(resumeData?.uploadedIndexes ?? []);
    let uploadedBytes = resumeData?.uploadedBytes ?? 0;
    onProgress(Math.round((uploadedBytes / file.size) * 100));

    const controller = new AbortController();
    abortRef.current = controller;
    cancelRef.current = false;

    const lock = { current: 0 };

    async function worker() {
      while (!cancelRef.current && !controller.signal.aborted) {
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
            const res = await fetch("/api/files/telegram/chunk", {
              method: "POST", body: formData, signal: controller.signal,
            });
            if (!res.ok) throw new Error(`Status ${res.status}`);
            success = true;
            uploadedBytes += chunkBlob.size;
            onProgress(Math.round((uploadedBytes / file.size) * 100));
          } catch (err: any) {
            if (cancelRef.current || controller.signal.aborted) throw { isCancelled: true };
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            else throw new Error(`Chunk ${index} failed after 3 attempts`);
          }
        }
      }
    }

    const workers = Array.from({ length: TELEGRAM_CONCURRENCY }, () => worker());
    try {
      await Promise.all(workers);
    } catch (err) {
      abortRef.current = null;
      currentFileIdRef.current = null;
      throw err;
    }
    abortRef.current = null;
    currentFileIdRef.current = null;

    if (cancelRef.current) throw { isCancelled: true };

    const completeRes = await fetch("/api/files/telegram/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    if (!completeRes.ok) throw new Error("Failed to complete Telegram upload");

    queryClient.invalidateQueries({ queryKey: ["files"] });
    return completeRes.json();
  }

  async function uploadSmart(file: File, hash: string, onProgress: (pct: number) => void) {
    if (storageType === "telegram") {
      return telegramUpload(file, hash, onProgress);
    }
    return file.size < SMALL_FILE_LIMIT
      ? smallUploadMutation.mutateAsync({ file, hash })
      : multipartUpload(file, hash, onProgress);
  }

  const getFileUrl = async (key: string): Promise<string> => {
    const res = await fetch("/api/files/fetch/url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error("Failed to get file URL");
    return (await res.json()).url;
  };

  // ── File actions ──────────────────────────────────────────────────────────────
  const openFile = async (file: FileType) => {
    if (file.backend === "telegram") {
      window.open(`/api/files/telegram/${file._id}/download`, "_blank");
    } else {
      const u = await getFileUrl(file.storageUrl);
      window.open(u, "_blank");
    }
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
      queryClient.invalidateQueries({ queryKey: ["files"] });
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

      queryClient.invalidateQueries({ queryKey: ["folders"] });
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
      queryClient.invalidateQueries({ queryKey: ["folders"] });
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
        queryClient.invalidateQueries({ queryKey: ["files"] });
        setToast({ msg: `"${(deleteTarget.item as FileType).filename}" deleted.`, type: "success" });
      } else {
        const res = await fetch(`/api/folders/${deleteTarget.item._id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed");
        queryClient.invalidateQueries({ queryKey: ["folders"] });
        queryClient.invalidateQueries({ queryKey: ["files"] });
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
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setNewFolderName(""); setShowNewFolder(false);
      setToast({ msg: `Folder "${name}" created.`, type: "success" });
    } catch { setToast({ msg: "Could not create folder.", type: "error" }); }
  };

  // ── Upload flow ───────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    cancelRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    if (intervalRef.current) clearInterval(intervalRef.current);

    const fileId = currentFileIdRef.current;
    if (fileId) {
      currentFileIdRef.current = null;
      try {
        await fetch("/api/files/telegram/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
      } catch {}
      queryClient.invalidateQueries({ queryKey: ["pending-files"] });
    }

    setStatus("idle"); setProgress(0);
    setToast({ msg: "Upload cancelled.", type: "warn" });
  };

  const handleFile = async (file: File) => {
    setStatus("uploading"); setProgress(0);
    setErrorMsg(""); setDuplicateFile(null);
    cancelRef.current = false;
    if (file.size < SMALL_FILE_LIMIT) {
      intervalRef.current = setInterval(() => setProgress((p) => (p < 85 ? p + 8 : p)), 150);
    }
    try {
      const hash = await getFileHash(file);
      await uploadSmart(file, hash, (pct) => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        setProgress(pct);
      });
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (!cancelRef.current) {
        setProgress(100); setStatus("success");
        setToast({ msg: `"${file.name}" uploaded successfully!`, type: "success" });
        setTimeout(() => setStatus("idle"), 3000);
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

  const handleResume = async (pendingFile: FileType, file: File) => {
    setResumingId(pendingFile._id);
    setStatus("uploading");
    setProgress(0);
    cancelRef.current = false;
    try {
      const hash = await getFileHash(file);
      if (pendingFile.hash && hash !== pendingFile.hash) {
        throw new Error("Selected file does not match the original. Hash mismatch.");
      }
      await telegramUpload(file, hash, (pct) => {
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        setProgress(pct);
      });
      setProgress(100);
      setStatus("success");
      setToast({ msg: `"${file.name}" upload resumed and completed!`, type: "success" });
      queryClient.invalidateQueries({ queryKey: ["pending-files"] });
      queryClient.invalidateQueries({ queryKey: ["files"] });
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err: unknown) {
      const uploadError = err as UploadError;
      if (uploadError?.isCancelled) return;
      setStatus("error");
      setErrorMsg(uploadError?.message || "Resume failed");
      setToast({ msg: uploadError?.message || "Resume failed.", type: "error" });
    } finally {
      setResumingId(null);
    }
  };

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

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .fu-root, .fu-ctx, .fu-overlay, .fu-toast {
          --bg: #0d0f14; --surface: #13161e; --surface2: #1a1e28;
          --border: #252a38; --border-hover: #353c52;
          --accent: #6c8eff; --accent-glow: rgba(108,142,255,0.15); --accent2: #a78bfa;
          --success: #34d399; --warn: #fbbf24; --error: #f87171;
          --text: #e8eaf0; --text-muted: #6b7280; --text-dim: #9ca3af;
          --danger: #f87171; --folder-color: #fbbf24;
        }
        .fu-root {
          font-family: 'DM Sans', sans-serif;
          background: var(--bg); min-height: 100vh; padding: 48px 24px; color: var(--text);
        }

        /* ── Top nav bar ── */
        .fu-topbar {
          max-width: 900px; margin: 0 auto 28px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .fu-topbar-brand {
          font-family: 'Syne', sans-serif; font-size: 1.5rem; font-weight: 800;
          letter-spacing: -0.03em;
          background: linear-gradient(135deg, #e8eaf0 0%, #6c8eff 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .fu-topbar-actions { display: flex; gap: 8px; }
        .fu-topbar-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 14px; border-radius: 9px;
          font-family: 'DM Sans', sans-serif; font-size: 0.8rem; font-weight: 500;
          cursor: pointer; border: 1px solid var(--border);
          background: var(--surface2); color: var(--text-dim); transition: all 0.15s;
        }
        .fu-topbar-btn:hover { border-color: var(--border-hover); color: var(--text); }
        .fu-topbar-btn.accent { border-color: rgba(108,142,255,0.3); color: var(--accent); background: var(--accent-glow); }
        .fu-topbar-btn.accent:hover { background: rgba(108,142,255,0.25); }

        /* ── Folder tabs ── */
        .fu-tabs-wrap {
          max-width: 900px; margin: 0 auto 20px;
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }
        .fu-tab {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 14px; border-radius: 99px; cursor: pointer;
          border: 1px solid var(--border); background: none; color: var(--text-muted);
          font-family: 'DM Sans', sans-serif; font-size: 0.8rem; font-weight: 500;
          transition: all 0.15s; white-space: nowrap;
        }
        .fu-tab:hover { border-color: var(--border-hover); color: var(--text); background: var(--surface2); }
        .fu-tab.active { background: var(--accent-glow); border-color: rgba(108,142,255,0.3); color: var(--accent); }
        .fu-tab-count {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); font-size: 0.68rem;
          padding: 1px 7px; border-radius: 99px; min-width: 20px; text-align: center;
        }
        .fu-tab.active .fu-tab-count { background: rgba(108,142,255,0.15); border-color: rgba(108,142,255,0.2); color: var(--accent); }
        .fu-tab-new {
          display: flex; align-items: center; gap: 5px;
          padding: 6px 12px; border-radius: 99px;
          border: 1px dashed var(--border); background: none; color: var(--text-muted);
          font-family: 'DM Sans', sans-serif; font-size: 0.78rem; cursor: pointer;
          transition: all 0.15s;
        }
        .fu-tab-new:hover { border-color: var(--accent); color: var(--accent); }
        .fu-new-folder-inline {
          display: flex; align-items: center; gap: 6px;
        }
        .fu-new-folder-input-inline {
          background: var(--surface2); border: 1px solid var(--accent);
          border-radius: 99px; padding: 5px 14px; color: var(--text);
          font-family: 'DM Sans', sans-serif; font-size: 0.8rem; outline: none; width: 160px;
        }
        .fu-new-folder-input-inline::placeholder { color: var(--text-muted); }
        .fu-btn-pill {
          padding: 5px 12px; border-radius: 99px;
          font-family: 'DM Sans', sans-serif; font-size: 0.75rem; font-weight: 500;
          cursor: pointer; border: 1px solid var(--border);
          background: var(--surface2); color: var(--text-dim); transition: all 0.15s;
        }
        .fu-btn-pill.accent { background: var(--accent-glow); border-color: rgba(108,142,255,0.3); color: var(--accent); }
        .fu-btn-pill.accent:hover { background: rgba(108,142,255,0.25); }

        /* ── Main content ── */
        .fu-shell { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 20px; align-items: start; }
        .fu-content { max-width: 900px; width: 100%; display: flex; flex-direction: column; gap: 24px; }
        .fu-insights {
          background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
          padding: 16px; position: sticky; top: 24px; display: flex; flex-direction: column; gap: 16px;
        }
        .fu-insight-title { font-family: 'Syne', sans-serif; font-size: 0.92rem; font-weight: 700; color: var(--text); }
        .fu-search-input {
          width: 100%; background: var(--surface2); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 12px; color: var(--text);
          font-family: 'DM Sans', sans-serif; font-size: 0.82rem; outline: none;
        }
        .fu-search-input:focus { border-color: rgba(108,142,255,0.45); }
        .fu-search-result {
          border: 1px solid var(--border); background: rgba(255,255,255,0.02);
          border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 5px;
        }
        .fu-search-result button { align-self: flex-start; }
        .fu-search-name { font-size: 0.8rem; font-weight: 600; color: var(--text); }
        .fu-search-snippet { font-size: 0.7rem; color: var(--text-muted); line-height: 1.45; }
        .fu-trust-card { border: 1px solid var(--border); border-radius: 10px; padding: 11px; background: var(--surface2); }
        .fu-trust-label { font-size: 0.72rem; color: var(--text-muted); margin-bottom: 4px; }
        .fu-trust-value { font-size: 0.88rem; color: var(--text); font-weight: 700; }
        @media (max-width: 1050px) { .fu-shell { grid-template-columns: 1fr; } .fu-insights { position: static; } }

        /* Header */
        .fu-header-sub { color: var(--text-muted); font-size: 0.85rem; font-weight: 300; margin-top: 4px; }
        .fu-header-actions { display: flex; gap: 8px; margin-top: 12px; }
        .fu-action-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 7px 13px; border-radius: 8px; font-family: 'DM Sans', sans-serif;
          font-size: 0.78rem; font-weight: 500; cursor: pointer;
          border: 1px solid var(--border); background: var(--surface2); color: var(--text-dim);
          transition: all 0.15s;
        }
        .fu-action-btn:hover { border-color: var(--border-hover); color: var(--text); }

        /* ── Drop zone ── */
        .fu-dropzone {
          background: var(--surface); border: 1.5px dashed var(--border);
          border-radius: 16px; padding: 40px 32px;
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 12px; cursor: pointer;
          transition: all 0.2s ease; position: relative; overflow: hidden;
          min-height: 180px; text-align: center;
        }
        .fu-dropzone::before {
          content: ''; position: absolute; inset: 0;
          background: radial-gradient(ellipse at 50% 0%, var(--accent-glow) 0%, transparent 70%);
          opacity: 0; transition: opacity 0.3s;
        }
        .fu-dropzone:hover::before, .fu-dropzone.dragging::before { opacity: 1; }
        .fu-dropzone:hover, .fu-dropzone.dragging { border-color: var(--accent); border-style: solid; transform: translateY(-1px); }
        .fu-dropzone-icon {
          width: 48px; height: 48px; background: var(--surface2);
          border: 1px solid var(--border); border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px; margin-bottom: 2px; transition: transform 0.2s;
        }
        .fu-dropzone:hover .fu-dropzone-icon { transform: scale(1.08); }
        .fu-dropzone-title { font-family: 'Syne', sans-serif; font-size: 0.95rem; font-weight: 600; color: var(--text); }
        .fu-dropzone-sub { font-size: 0.78rem; color: var(--text-muted); }
        .fu-dropzone-sub span { color: var(--accent); font-weight: 500; }

        .fu-pending-banner {
          width: 100%; margin-top: 12px; padding: 12px 14px;
          background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.2);
          border-radius: 10px; display: flex; flex-direction: column; gap: 8px;
        }
        .fu-pending-banner-title {
          font-size: 0.78rem; font-weight: 600; color: var(--warn);
        }
        .fu-pending-row {
          display: flex; align-items: center; gap: 8px;
        }
        .fu-pending-name {
          font-size: 0.75rem; color: var(--text); flex: 1; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .fu-pending-meta {
          font-size: 0.68rem; color: var(--text-muted); flex-shrink: 0;
        }
        .fu-pending-btn {
          flex-shrink: 0; padding: 3px 10px; border-radius: 6px;
          font-family: 'DM Sans', sans-serif; font-size: 0.7rem; font-weight: 500;
          cursor: pointer; border: 1px solid var(--border); background: var(--surface2);
          transition: all 0.15s; color: var(--text-dim);
        }
        .fu-pending-btn.resume { color: var(--warn); border-color: rgba(251,191,36,0.3); }
        .fu-pending-btn.resume:hover:not(:disabled) { background: rgba(251,191,36,0.1); }
        .fu-pending-btn.cancel { color: var(--error); border-color: rgba(248,113,113,0.25); }
        .fu-pending-btn.cancel:hover { background: rgba(248,113,113,0.08); }
        .fu-pending-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .fu-progress-wrap { width: 100%; display: flex; flex-direction: column; gap: 10px; }
        .fu-progress-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; }
        .fu-progress-label { color: var(--text-dim); font-weight: 500; }
        .fu-progress-pct { color: var(--accent); font-family: 'Syne', sans-serif; font-weight: 700; }
        .fu-bar-bg { width: 100%; height: 5px; background: var(--surface2); border-radius: 99px; overflow: hidden; }
        .fu-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent) 0%, var(--accent2) 100%);
          border-radius: 99px; transition: width 0.15s ease;
        }
        .fu-cancel-btn {
          align-self: center; background: transparent; border: 1px solid var(--border);
          color: var(--text-muted); font-family: 'DM Sans', sans-serif;
          font-size: 0.78rem; padding: 5px 14px; border-radius: 8px; cursor: pointer; transition: all 0.15s;
        }
        .fu-cancel-btn:hover { border-color: var(--error); color: var(--error); }
        .fu-status { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; font-weight: 500; }
        .fu-status.success { color: var(--success); }
        .fu-status.error   { color: var(--error); }
        .fu-status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1.2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.3)} }
        .fu-duplicate {
          background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.25);
          border-radius: 10px; padding: 14px 16px;
          display: flex; flex-direction: column; gap: 10px; width: 100%; text-align: left;
        }
        .fu-duplicate-title { font-size: 0.85rem; font-weight: 600; color: var(--warn); }
        .fu-dup-open-btn {
          background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3);
          color: var(--warn); font-family: 'DM Sans', sans-serif;
          font-size: 0.78rem; font-weight: 500; padding: 6px 14px;
          border-radius: 7px; cursor: pointer; transition: all 0.15s; align-self: flex-start;
        }
        .fu-dup-open-btn:hover { background: rgba(251,191,36,0.2); }

        /* ── Folder grid ── */
        .fu-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .fu-section-title { font-family: 'Syne', sans-serif; font-size: 0.9rem; font-weight: 700; color: var(--text); }
        .fu-section-count {
          font-size: 0.72rem; background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); padding: 2px 10px; border-radius: 99px;
        }
        .fu-folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .fu-folder-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 16px 14px;
          display: flex; flex-direction: column; gap: 8px;
          cursor: pointer; transition: all 0.15s; position: relative;
        }
        .fu-folder-card:hover { border-color: rgba(251,191,36,0.35); transform: translateY(-2px); background: rgba(251,191,36,0.04); }
        .fu-folder-icon { font-size: 26px; }
        .fu-folder-name { font-size: 0.8rem; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fu-folder-count { font-size: 0.68rem; color: var(--text-muted); }
        .fu-folder-card-opts {
          position: absolute; top: 8px; right: 8px;
          background: none; border: none; color: var(--text-muted);
          cursor: pointer; font-size: 13px; padding: 2px 5px; border-radius: 5px;
          opacity: 0; transition: opacity 0.15s;
        }
        .fu-folder-card:hover .fu-folder-card-opts { opacity: 1; }

        /* ── File list ── */
        .fu-file-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 12px 14px;
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 7px; transition: all 0.15s;
        }
        .fu-file-card:hover { border-color: var(--border-hover); transform: translateX(2px); }
        .fu-file-icon {
          font-size: 20px; flex-shrink: 0; width: 38px; height: 38px;
          background: var(--surface2); border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
        }
        .fu-file-info { flex: 1; overflow: hidden; }
        .fu-file-name { font-size: 0.85rem; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fu-file-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; }
        .fu-file-actions { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
        .fu-icon-btn {
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text-muted); font-size: 0.72rem; font-weight: 500;
          padding: 5px 10px; border-radius: 7px; cursor: pointer; transition: all 0.15s;
          white-space: nowrap;
        }
        .fu-icon-btn:hover { background: var(--surface); border-color: var(--border-hover); color: var(--text); }
        .fu-icon-btn.open  { color: var(--accent); border-color: rgba(108,142,255,0.25); }
        .fu-icon-btn.open:hover  { background: var(--accent-glow); }
        .fu-icon-btn.share { color: var(--success); border-color: rgba(52,211,153,0.25); }
        .fu-icon-btn.share:hover { background: rgba(52,211,153,0.1); }
        .fu-icon-btn.danger:hover { color: var(--error); border-color: rgba(248,113,113,0.3); background: rgba(248,113,113,0.08); }

        /* ── Context menu ── */
        .fu-ctx {
          position: fixed; background: var(--surface2); border: 1px solid var(--border);
          border-radius: 12px; padding: 6px; min-width: 170px; z-index: 1000;
          box-shadow: 0 12px 40px rgba(0,0,0,0.5); animation: ctxIn 0.12s ease;
        }
        @keyframes ctxIn { from{opacity:0;transform:scale(0.95)} to{opacity:1;transform:scale(1)} }
        .fu-ctx-item {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: 8px; cursor: pointer;
          font-size: 0.82rem; color: var(--text-dim); transition: all 0.1s; border: none;
          background: none; width: 100%; text-align: left; font-family: 'DM Sans', sans-serif;
        }
        .fu-ctx-item:hover { background: var(--surface); color: var(--text); }
        .fu-ctx-item.danger:hover { color: var(--error); background: rgba(248,113,113,0.08); }
        .fu-ctx-sep { height: 1px; background: var(--border); margin: 4px 0; }

        /* ── Modals ── */
        .fu-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.65);
          display: flex; align-items: center; justify-content: center; z-index: 500;
          animation: fadeIn 0.15s ease;
        }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        .fu-modal {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 18px; padding: 28px; width: 100%; max-width: 400px;
          animation: slideUp 0.2s ease;
        }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .fu-modal-title { font-family: 'Syne', sans-serif; font-size: 1.05rem; font-weight: 700; color: var(--text); margin-bottom: 6px; }
        .fu-modal-sub { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 20px; }
        .fu-modal-actions { display: flex; gap: 8px; margin-top: 20px; }
        .fu-modal-btn {
          flex: 1; padding: 9px; border-radius: 9px;
          font-family: 'DM Sans', sans-serif; font-size: 0.83rem; font-weight: 500; cursor: pointer; transition: all 0.15s;
        }
        .fu-modal-btn.secondary { background: var(--surface2); border: 1px solid var(--border); color: var(--text-dim); }
        .fu-modal-btn.secondary:hover { color: var(--text); border-color: var(--border-hover); }
        .fu-modal-btn.primary { background: var(--accent-glow); border: 1px solid rgba(108,142,255,0.35); color: var(--accent); }
        .fu-modal-btn.primary:hover { background: rgba(108,142,255,0.25); }
        .fu-modal-btn.danger { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: var(--error); }
        .fu-modal-btn.danger:hover { background: rgba(248,113,113,0.18); }
        .fu-share-url-wrap {
          display: flex; gap: 6px; background: var(--surface2); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 12px;
        }
        .fu-share-url {
          flex: 1; font-size: 0.78rem; color: var(--text-dim);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          background: none; border: none; outline: none; font-family: 'DM Sans', sans-serif; cursor: default;
        }
        .fu-copy-btn {
          background: var(--accent-glow); border: 1px solid rgba(108,142,255,0.3);
          color: var(--accent); font-size: 0.75rem; font-weight: 500;
          padding: 4px 10px; border-radius: 7px; cursor: pointer; flex-shrink: 0;
          font-family: 'DM Sans', sans-serif; transition: all 0.15s;
        }
        .fu-copy-btn.copied { background: rgba(52,211,153,0.15); border-color: rgba(52,211,153,0.35); color: var(--success); }
        .fu-folder-picker { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; }
        .fu-picker-item {
          display: flex; align-items: center; gap: 10px; padding: 9px 12px;
          border-radius: 9px; cursor: pointer; border: 1px solid transparent;
          font-size: 0.83rem; color: var(--text-dim); background: none; text-align: left;
          font-family: 'DM Sans', sans-serif; width: 100%; transition: all 0.12s;
        }
        .fu-picker-item:hover { background: var(--surface2); border-color: var(--border); color: var(--text); }
        .fu-picker-item.active { background: var(--accent-glow); border-color: rgba(108,142,255,0.25); color: var(--accent); }
        .fu-move-create {
          display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px;
          border: 1px dashed rgba(108,142,255,0.35); border-radius: 10px;
          padding: 8px; background: rgba(108,142,255,0.06);
        }
        .fu-move-create input {
          min-width: 0; background: var(--surface2); border: 1px solid var(--border);
          color: var(--text); border-radius: 8px; padding: 8px 10px;
          font-family: 'DM Sans', sans-serif; font-size: 0.8rem; outline: none;
        }
        .fu-move-create button {
          background: var(--accent-glow); border: 1px solid rgba(108,142,255,0.35);
          color: var(--accent); border-radius: 8px; padding: 8px 10px;
          font-family: 'DM Sans', sans-serif; font-size: 0.78rem; font-weight: 600; cursor: pointer;
        }

        /* ── Toast ── */
        .fu-toast {
          position: fixed; bottom: 28px; right: 28px;
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: 12px; padding: 12px 18px; font-size: 0.82rem; font-weight: 500;
          display: flex; align-items: center; gap: 10px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4); animation: slideUp 0.25s ease; z-index: 999; max-width: 320px;
        }
        .fu-toast.success { border-color: rgba(52,211,153,0.3); color: var(--success); }
        .fu-toast.warn    { border-color: rgba(251,191,36,0.3);  color: var(--warn); }
        .fu-toast.error   { border-color: rgba(248,113,113,0.3); color: var(--error); }

        .fu-skeleton {
          height: 60px;
          background: linear-gradient(90deg, var(--surface) 25%, var(--surface2) 50%, var(--surface) 75%);
          background-size: 200% 100%; animation: shimmer 1.4s infinite;
          border-radius: 12px; margin-bottom: 7px;
        }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .fu-empty { text-align: center; padding: 40px 0; color: var(--text-muted); font-size: 0.85rem; }
        .fu-empty-icon { font-size: 2rem; margin-bottom: 10px; opacity: 0.4; }
      `}</style>

      <div className="fu-root">

        {/* ── Top nav ── */}
        <div className="fu-topbar">
          <div className="fu-topbar-brand">Storage</div>
          <div className="fu-topbar-actions">
            <button className="fu-topbar-btn accent" onClick={() => router.push("/sidebar")}>
              Browse by type
            </button>
          </div>
        </div>

        {/* ── Folder tabs ── */}
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
              <button className="fu-btn-pill" onClick={() => setShowNewFolder(false)}>✕</button>
              <button className="fu-btn-pill accent" onClick={createFolder}>Create</button>
            </div>
          ) : (
            <button className="fu-tab-new" onClick={() => setShowNewFolder(true)}>+ New folder</button>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="fu-shell">
        <div className="fu-content">

          {/* Header */}
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", fontWeight: 300 }}>
              {currentFolder
                ? `${visibleFiles.length} file${visibleFiles.length !== 1 ? "s" : ""} in "${currentFolder.name}"`
                : "Drop files to upload, or browse from your device."}
            </div>
            {currentFolder && (
              <div className="fu-header-actions">
                <button className="fu-action-btn" onClick={() => downloadFolder(currentFolder)}>
                  ⬇ Download folder
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
            onClick={() => status !== "uploading" && inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" hidden onChange={onInputChange} />

            {status === "idle" && (
              <>
                <div className="fu-dropzone-icon">☁️</div>
                <div className="fu-dropzone-title">
                  Drop your file here{currentFolder ? ` into "${currentFolder.name}"` : ""}
                </div>
                <div className="fu-dropzone-sub">
                  or <span>browse</span> — under 10 MB uploads instantly, larger files use multipart
                </div>
                {pendingFiles.length > 0 && (
                  <div className="fu-pending-banner" onClick={(e) => e.stopPropagation()}>
                    <div className="fu-pending-banner-title">
                      ⏳ {pendingFiles.length} pending upload{pendingFiles.length > 1 ? "s" : ""}
                    </div>
                    {pendingFiles.map((pf) => (
                      <div key={pf._id} className="fu-pending-row">
                        <span className="fu-pending-name">{pf.filename}</span>
                        <span className="fu-pending-meta">{formatBytes(pf.size)}</span>
                        <button
                          className="fu-pending-btn resume"
                          disabled={resumingId === pf._id}
                          onClick={async () => {
                            const fileInput = document.createElement("input");
                            fileInput.type = "file";
                            fileInput.onchange = async () => {
                              const f = fileInput.files?.[0];
                              if (f) await handleResume(pf, f);
                            };
                            fileInput.click();
                          }}
                        >
                          {resumingId === pf._id ? "⟳ Resuming..." : "⟳ Resume"}
                        </button>
                        <button
                          className="fu-pending-btn cancel"
                          onClick={async () => {
                            try {
                              await fetch("/api/files/telegram/cancel", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ fileId: pf._id }),
                              });
                              queryClient.invalidateQueries({ queryKey: ["pending-files"] });
                              setToast({ msg: `Cancelled "${pf.filename}"`, type: "success" });
                            } catch {
                              setToast({ msg: "Failed to cancel.", type: "error" });
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {status === "uploading" && (
              <div className="fu-progress-wrap" onClick={(e) => e.stopPropagation()}>
                <div className="fu-progress-row">
                  <span className="fu-progress-label">Uploading</span>
                  <span className="fu-progress-pct">{progress}%</span>
                </div>
                <div className="fu-bar-bg"><div className="fu-bar-fill" style={{ width: `${progress}%` }} /></div>
                <button className="fu-cancel-btn" onClick={handleCancel}>✕ Cancel</button>
              </div>
            )}
            {status === "success" && (
              <div className="fu-status success"><div className="fu-status-dot" /> File uploaded successfully</div>
            )}
            {status === "error" && (
              <>
                <div className="fu-status error">✕ {errorMsg || "Upload failed"}</div>
                <div className="fu-dropzone-sub" style={{ marginTop: 4 }}>Click to try again</div>
              </>
            )}
            {status === "duplicate" && duplicateFile && (
              <div className="fu-duplicate" onClick={(e) => e.stopPropagation()}>
                <div className="fu-duplicate-title">⚠ Duplicate file detected</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  <span>{duplicateFile.filename}</span> already exists in your storage.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="fu-dup-open-btn" onClick={async () => openFile(duplicateFile)}>
                    Open existing →
                  </button>
                  <button
                    className="fu-dup-open-btn"
                    style={{ background: "rgba(108,142,255,0.1)", borderColor: "rgba(108,142,255,0.3)", color: "var(--accent)" }}
                    onClick={() => downloadFile(duplicateFile)}
                  >
                    ⬇ Download
                  </button>
                </div>
              </div>
            )}
          </div>

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
                    <button className="fu-folder-card-opts" onClick={(e) => { e.stopPropagation(); openCtx(e, folder, "folder"); }}>⋯</button>
                    <div className="fu-folder-icon">📁</div>
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
              <span className="fu-section-title">{currentFolder ? "Files" : "All Files"}</span>
              {!filesLoading && <span className="fu-section-count">{visibleFiles.length}</span>}
            </div>
            {filesLoading ? (
              <><div className="fu-skeleton" /><div className="fu-skeleton" /><div className="fu-skeleton" /></>
            ) : visibleFiles.length === 0 ? (
              <div className="fu-empty">
                <div className="fu-empty-icon">📂</div>
                <div>{currentFolder ? "No files in this folder yet" : "No files uploaded yet"}</div>
              </div>
            ) : (
              visibleFiles.map((file) => (
                <div key={file._id} className="fu-file-card" onContextMenu={(e) => openCtx(e, file, "file")}>
                  <div className="fu-file-icon">{getFileIcon(file.mimetype)}</div>
                  <div className="fu-file-info">
                    <div className="fu-file-name">{file.filename}</div>
                    <div className="fu-file-meta">
                      {formatBytes(file.size)} · {new Date(file.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {file.folderId && folders.find(f => f._id === file.folderId) && (
                        <span style={{ marginLeft: 6, color: "var(--folder-color)", fontSize: "0.68rem" }}>
                          📁 {folders.find(f => f._id === file.folderId)?.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="fu-file-actions">
                    <button className="fu-icon-btn open"
                      onClick={async () => openFile(file)}>
                      Open ↗
                    </button>
                    <button className="fu-icon-btn share" onClick={() => openShareModal(file)}>Share</button>
                    <button className="fu-icon-btn" onClick={() => openVersions(file)}>Versions</button>
                    <button className="fu-icon-btn" onClick={() => downloadFile(file)}>⬇</button>

                    {/* Three-dot menu */}
                    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="fu-icon-btn"
                        style={openMenuId === file._id ? { borderColor: "var(--border-hover)", color: "var(--text)" } : {}}
                        onClick={() => setOpenMenuId(openMenuId === file._id ? null : file._id)}
                      >
                        ⋯
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
                            ↗ Open
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
                            ⬇ Download
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

          {/* ── Pending Uploads ── */}
          {!pendingLoading && pendingFiles.length > 0 && (
            <div>
              <div className="fu-section-header">
                <span className="fu-section-title">⏳ Pending Uploads</span>
                <span className="fu-section-count">{pendingFiles.length}</span>
              </div>
              {pendingFiles.map((pf) => (
                <div key={pf._id} className="fu-file-card" style={{ borderColor: "rgba(251,191,36,0.3)" }}>
                  <div className="fu-file-icon">⏳</div>
                  <div className="fu-file-info">
                    <div className="fu-file-name">{pf.filename}</div>
                    <div className="fu-file-meta">
                      {formatBytes(pf.size)} · {new Date(pf.createdAt).toLocaleDateString()} · {pf.backend === "telegram" ? "☁️ Telegram" : "☁️ S3"}
                    </div>
                  </div>
                  <div className="fu-file-actions">
                    <button
                      className="fu-icon-btn"
                      style={{
                        color: "var(--warn)",
                        borderColor: "rgba(251,191,36,0.3)",
                        opacity: resumingId === pf._id ? 0.5 : 1,
                      }}
                      disabled={resumingId === pf._id}
                      onClick={() => {
                        const fileInput = document.createElement("input");
                        fileInput.type = "file";
                        fileInput.onchange = async () => {
                          const f = fileInput.files?.[0];
                          if (f) await handleResume(pf, f);
                        };
                        fileInput.click();
                      }}
                    >
                      {resumingId === pf._id ? "⟳ Resuming..." : "⟳ Resume"}
                    </button>
                    <button
                      className="fu-icon-btn danger"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/files/telegram/cancel`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ fileId: pf._id }),
                          });
                          if (!res.ok) throw new Error("Failed");
                          queryClient.invalidateQueries({ queryKey: ["pending-files"] });
                          setToast({ msg: `Cancelled "${pf.filename}"`, type: "success" });
                        } catch {
                          setToast({ msg: "Failed to cancel upload.", type: "error" });
                        }
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <aside className="fu-insights">
          <div>
            <div className="fu-insight-title">Full-content search</div>
            <input
              className="fu-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search PDFs, code, text..."
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {searchQuery.trim().length < 2 ? (
              <div className="fu-search-snippet">Type at least 2 characters to search names and indexed file contents.</div>
            ) : searchResults.length === 0 ? (
              <div className="fu-search-snippet">No matches yet.</div>
            ) : (
              searchResults.map((result) => (
                <div className="fu-search-result" key={result._id}>
                  <div className="fu-search-name">{getFileIcon(result.mimetype)} {result.filename}</div>
                  <div className="fu-search-snippet">
                    {result.matchedContent ? result.snippet || "Matched inside file content." : "Matched by file name or type."}
                  </div>
                  <button
                    className="fu-icon-btn open"
                    onClick={async () => openFile(result)}
                  >
                    Open
                  </button>
                </div>
              ))
            )}
          </div>
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

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div className="fu-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          {ctxMenu.itemType === "file" ? (
            <>
              <button className="fu-ctx-item" onClick={async () => { await openFile(ctxMenu.item as FileType); setCtxMenu(null); }}>↗ Open</button>
              <button className="fu-ctx-item" onClick={() => { openShareModal(ctxMenu.item as FileType); setCtxMenu(null); }}>Share</button>
              <button className="fu-ctx-item" onClick={() => { downloadFile(ctxMenu.item as FileType); setCtxMenu(null); }}>⬇ Download</button>
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
              <button className="fu-ctx-item" onClick={() => { downloadFolder(ctxMenu.item as FolderType); setCtxMenu(null); }}>⬇ Download as ZIP</button>
              <div className="fu-ctx-sep" />
              <button className="fu-ctx-item danger" onClick={() => { setDeleteTarget({ type: "folder", item: ctxMenu.item as FolderType }); setCtxMenu(null); }}>Delete folder</button>
            </>
          )}
        </div>
      )}

      {/* ── Share modal ── */}
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
                  {shareCopied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Generating link…</div>
            )}
            <div className="fu-modal-actions">
              <button className="fu-modal-btn secondary" onClick={() => setShareTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Move modal ── */}
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

      {/* ── Version history modal ── */}
      {versionTarget && (
        <div className="fu-overlay" onClick={() => setVersionTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">Version history</div>
            <div className="fu-modal-sub">Every saved version of <span>{versionTarget.filename}</span> is visible here.</div>
            <div className="fu-folder-picker">
              {versionsLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Loading versions…</div>
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

      {/* ── Delete confirm modal ── */}
      {deleteTarget && (
        <div className="fu-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="fu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fu-modal-title">⚠ Confirm delete</div>
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

      {/* ── Toast ── */}
      {toast && (
        <div className={`fu-toast ${toast.type}`}>
          {toast.type === "success" ? "✓" : toast.type === "warn" ? "⚠" : "✕"} {toast.msg}
        </div>
      )}
    </>
  );
}