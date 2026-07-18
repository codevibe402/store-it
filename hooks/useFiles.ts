"use client";

import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { getSessionDEK } from "./useFileEncryption";
import { fetchManifest, fetchAndDecryptFile } from "@/client/lib/decryptedDownload";
import { getCachedPreviewBlob, storeCachedPreviewBlob } from "@/client/lib/previewCache";

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

type ToastMsg = { msg: string; type: "error" | "warn" | "success" };

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

export function useFiles(files: FileType[], folders: FolderType[]) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [moveTarget, setMoveTarget] = useState<FileType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "file"; item: FileType } | { type: "folder"; item: FolderType } | null>(null);
  const [versionTarget, setVersionTarget] = useState<FileType | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  // File sharing only — folder sharing has its own richer state/actions in
  // hooks/useFolderShare.ts (people + role management, links, revoke).
  const [fileShareTarget, setFileShareTarget] = useState<FileType | null>(null);
  const [fileShareUrl, setFileShareUrl] = useState("");
  const [fileShareCopied, setFileShareCopied] = useState(false);

  // Zero-knowledge (DEK-encrypted) files can't just be opened at their raw
  // URL — the server never has the key, so that would hand the browser
  // ciphertext. Check the manifest first; only files that actually need
  // client-side decryption take the fetch-chunks-and-decrypt path, so
  // everything else (S3, server-managed encryption, unencrypted) is
  // untouched and just as fast as before.
  const resolveDecryptedBlobUrl = async (file: FileType): Promise<string | null> => {
    const manifest = await fetchManifest(file._id);
    if (!manifest.requiresClientDecrypt) return null;

    // versionId is stable per uploaded version (a new version gets a new
    // one), so a cache hit here is guaranteed to be this exact content —
    // skips re-fetching every chunk and re-running AES-GCM decryption on a
    // file this device has already opened before.
    if (manifest.versionId) {
      const cached = await getCachedPreviewBlob(file._id, manifest.versionId);
      if (cached) return window.URL.createObjectURL(cached.blob);
    }

    const dek = getSessionDEK();
    if (!dek) {
      toast.error("This file is encrypted and this device isn't unlocked yet. Enter your recovery code to access it.");
      return "";
    }

    const blob = await fetchAndDecryptFile(file._id, manifest, dek);
    if (manifest.versionId) {
      storeCachedPreviewBlob(file._id, manifest.versionId, blob, manifest.mimetype || "application/octet-stream");
    }
    return window.URL.createObjectURL(blob);
  };

  const openFile = async (file: FileType) => {
    if (file.backend !== "telegram") {
      window.open(`/api/files/${file._id}/download?preview=1`, "_blank");
      return;
    }
    try {
      const decryptedUrl = await resolveDecryptedBlobUrl(file);
      if (decryptedUrl === "") return; // missing DEK, already toasted
      window.open(decryptedUrl ?? `/api/files/${file._id}/download?preview=1`, "_blank");
    } catch {
      toast.error("Failed to open file");
    }
  };

  const downloadFile = async (file: FileType) => {
    try {
      let blobUrl: string | null = null;
      if (file.backend === "telegram") {
        const decryptedUrl = await resolveDecryptedBlobUrl(file);
        if (decryptedUrl === "") return; // missing DEK, already toasted
        blobUrl = decryptedUrl;
      }
      if (!blobUrl) {
        const res = await fetch(`/api/files/${file._id}/download`);
        if (!res.ok) throw new Error("Download failed");
        blobUrl = window.URL.createObjectURL(await res.blob());
      }
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = file.filename;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Download failed");
    }
  };

  const downloadFolder = async (folder: FolderType) => {
    try {
      const res = await fetch(`/api/folders/${folder._id}/download`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folder.name}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      // Handle error
    }
  };

  const moveFile = async (file: FileType, targetFolderId: string | null) => {
    try {
      const res = await fetch(`/api/files/${file._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      // Handle error
    }
  };

  const openShareModal = async (file: FileType) => {
    setFileShareTarget(file);
    setFileShareUrl("");
    setFileShareCopied(false);
    try {
      const res = await fetch(`/api/files/${file._id}/share`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const { shareUrl: url } = await res.json();
      setFileShareUrl(url);
    } catch {
      setFileShareTarget(null);
    }
  };

  const copyFileShareUrl = () => {
    if (!fileShareUrl) return;
    navigator.clipboard.writeText(fileShareUrl);
    setFileShareCopied(true);
    setTimeout(() => setFileShareCopied(false), 2000);
  };

  const duplicateFile = async (file: FileType) => {
    try {
      const res = await fetch(`/api/files/${file._id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to duplicate");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      // Handle error
    }
  };

  const renameFile = async (file: FileType, newName: string) => {
    try {
      const res = await fetch(`/api/files/${file._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      // Handle error
    }
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
      // Handle error
    } finally {
      setVersionsLoading(false);
    }
  };

  const openVersionUrl = async (version: any) => {
    const res = await fetch(`/api/files/${versionTarget!._id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageUrl: version.storageUrl }),
    });
    if (!res.ok) {
      // Handle error
      return;
    }
    const { url } = await res.json();
    window.open(url, "_blank");
  };

  const deleteFile = async (fileId: string) => {
    // Optimistic: remove instantly from the UI
    queryClient.setQueryData<{ files: FileType[]; folders: FolderType[]; pendingFiles: FileType[] }>(["dashboard"], (old) => {
      if (!old) return old;
      return {
        ...old,
        files: old.files.filter((f) => f._id !== fileId),
      };
    });
    try {
      const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      if (session?.user?.id) {
        queryClient.invalidateQueries({ queryKey: ["recycle", session.user.id] });
      }
    } catch {
      // Rollback on failure
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  const deleteFolder = async (folderId: string) => {
    queryClient.setQueryData<{ files: FileType[]; folders: FolderType[]; pendingFiles: FileType[] }>(["dashboard"], (old) => {
      if (!old) return old;
      return {
        ...old,
        folders: old.folders.filter((f) => f._id !== folderId),
      };
    });
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    } catch {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  return {
    moveTarget,
    setMoveTarget,
    deleteTarget,
    setDeleteTarget,
    versionTarget,
    setVersionTarget,
    versions,
    versionsLoading,
    setVersionsLoading,
    fileShareTarget,
    setFileShareTarget,
    fileShareUrl,
    fileShareCopied,
    openFile,
    downloadFile,
    downloadFolder,
    moveFile,
    openShareModal,
    copyFileShareUrl,
    duplicateFile,
    renameFile,
    openVersions,
    openVersionUrl,
    deleteFile,
    deleteFolder,
  };
}