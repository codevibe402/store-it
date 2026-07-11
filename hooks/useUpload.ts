"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

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

type UploadStatus = "idle" | "uploading" | "paused" | "success" | "error" | "duplicate";

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

export function useUpload(currentFolderId: string | null) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [duplicateFile, setDuplicateFile] = useState<FileType | null>(null);
  const [currentFileName, setCurrentFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const currentFileIdRef = useRef<string | null>(null);
  const currentUploadRef = useRef<{ backend: "s3" | "telegram"; fileId: string; uploadId?: string; key?: string } | null>(null);
  const pausedFileRef = useRef<{ fileId: string; filename: string } | null>(null);
  const cancelledIds = useRef(new Set<string>());
  const hasAttemptedAutoResume = useRef(false);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const handleFile = useCallback(async (file: File) => {
    setStatus("uploading");
    setProgress(0);
    setCurrentFileName(file.name);
    setError("");
    setDuplicateFile(null);
    cancelRef.current = false;
    pauseRef.current = false;

    if (file.size < SMALL_FILE_LIMIT) {
      intervalRef.current = setInterval(() => setProgress((p) => (p < 85 ? p + 8 : p)), 150);
    }

    try {
      const hash = await getFileHash(file);
      // Upload logic would continue here
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }, []);

  const cancelUpload = () => {
    cancelRef.current = true;
    pauseRef.current = false;
    abortRef.current?.abort();
    if (intervalRef.current) clearInterval(intervalRef.current);
    setStatus("idle");
    setProgress(0);
  };

  const pauseUpload = () => {
    pauseRef.current = true;
    abortRef.current?.abort();
    if (intervalRef.current) clearInterval(intervalRef.current);
    setStatus("paused");
    setProgress(0);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    status,
    progress,
    error,
    duplicateFile,
    currentFileName,
    dragging,
    setDragging,
    showPending,
    setShowPending,
    resumingId,
    setResumingId,
    formatBytes,
    handleFile,
    cancelUpload,
    pauseUpload,
    cancelledIds,
  };
}