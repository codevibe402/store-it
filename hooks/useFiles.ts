"use client";

import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

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
  const [moveTarget, setMoveTarget] = useState<FileType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "file"; item: FileType } | { type: "folder"; item: FolderType } | null>(null);
  const [versionTarget, setVersionTarget] = useState<FileType | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ type: "file"; item: FileType } | { type: "folder"; item: FolderType } | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [sharePermission, setSharePermission] = useState<"read" | "add">("read");
  const [shareExpiresInDays, setShareExpiresInDays] = useState(7);

  const openFile = (file: FileType) => {
    window.open(`/api/files/${file._id}/download?preview=1`, "_blank");
  };

  const downloadFile = async (file: FileType) => {
    try {
      const res = await fetch(`/api/files/${file._id}/download`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = file.filename;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      // Handle error
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
    setShareTarget({ type: "file", item: file });
    setShareUrl("");
    setShareCopied(false);
    try {
      const res = await fetch(`/api/files/${file._id}/share`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const { shareUrl: url } = await res.json();
      setShareUrl(url);
    } catch {
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
      setShareTarget(null);
    }
  };

  const copyShareUrl = async (fileOrFolder: FileType | FolderType, isFolder = false) => {
    try {
      const endpoint = isFolder
        ? `/api/folders/${(fileOrFolder as FolderType)._id}/share`
        : `/api/files/${(fileOrFolder as FileType)._id}/share`;
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const { shareUrl: url } = await res.json();
      navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Handle error
    }
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
    try {
      const res = await fetch(`/api/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      // Handle error
    }
  };

  const deleteFolder = async (folderId: string) => {
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      // Handle error
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
    shareTarget,
    setShareTarget,
    shareUrl,
    setShareUrl,
    shareCopied,
    setShareCopied,
    sharePermission,
    setSharePermission,
    shareExpiresInDays,
    setShareExpiresInDays,
    openFile,
    downloadFile,
    downloadFolder,
    moveFile,
    openShareModal,
    openFolderShareModal,
    copyShareUrl,
    duplicateFile,
    renameFile,
    openVersions,
    openVersionUrl,
    deleteFile,
    deleteFolder,
  };
}