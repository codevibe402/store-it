"use client";

import { useState, useRef, useCallback } from "react";
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

export function useUpload(currentFolderId: string | null) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [duplicateFile, setDuplicateFile] = useState<FileType | null>(null);
  const [currentFileName, setCurrentFileName] = useState("");

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancelledIds = useRef(new Set<string>());

  const getFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const clearIntervals = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const cancelUpload = useCallback(() => {
    cancelRef.current = true;
    pauseRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    clearIntervals();
    setStatus("idle");
    setProgress(0);
    setCurrentFileName("");
  }, []);

  const pauseUpload = useCallback(() => {
    pauseRef.current = true;
    clearIntervals();
    setStatus("paused");
  }, []);

  const handleFile = useCallback(async (file: File, folderId?: string | null) => {
    const targetFolderId = folderId ?? currentFolderId;
    setStatus("uploading");
    setProgress(0);
    setCurrentFileName(file.name);
    setError("");
    setDuplicateFile(null);
    cancelRef.current = false;
    pauseRef.current = false;

    try {
      const hash = await getFileHash(file);

      if (file.size <= SMALL_FILE_LIMIT) {
        intervalRef.current = setInterval(() => setProgress((p) => (p < 85 ? p + 8 : p)), 150);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("hash", hash);
        formData.append("folderId", targetFolderId ?? "");

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        });

        clearIntervals();

        if (res.status === 409) {
          const body = await res.json();
          setStatus("duplicate");
          setDuplicateFile(body.existingFile);
          setProgress(0);
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(body.error || `Upload failed (${res.status})`);
        }

        setProgress(100);
        setStatus("success");
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        return;
      }

      // Large file: Telegram multipart upload
      const initRes = await fetch("/api/files/telegram/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          hash,
          folderId: targetFolderId,
          useEncryption: true,
        }),
      });

      if (!initRes.ok) {
        const body = await initRes.json().catch(() => ({ error: "Init failed" }));
        throw new Error(body.error || "Failed to init upload");
      }

      const initData = await initRes.json();
      if (initData.isDuplicate) {
        clearIntervals();
        setStatus("duplicate");
        setDuplicateFile(initData.existingFile);
        return;
      }

      // Upload chunks in sequence (simpler than concurrent workers)
      const fileId = initData.fileId;
      const totalChunks = initData.totalChunks;
      const chunkSize = initData.chunkSize || 4 * 1024 * 1024;
      let uploadedBytes = 0;

      const controller = new AbortController();
      abortRef.current = controller;

      for (let i = 0; i < totalChunks; i++) {
        if (cancelRef.current || pauseRef.current) break;

        const start = i * chunkSize;
        const chunkBlob = file.slice(start, Math.min(start + chunkSize, file.size));

        const chunkForm = new FormData();
        chunkForm.append("fileId", fileId);
        chunkForm.append("chunkIndex", String(i));
        chunkForm.append("hash", await getChunkHash(chunkBlob));
        chunkForm.append("chunk", chunkBlob);
        chunkForm.append("useEncryption", "true");

        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          if (cancelRef.current || pauseRef.current) break;
          try {
            const chunkRes = await fetch("/api/files/telegram/chunk", {
              method: "POST",
              body: chunkForm,
              signal: controller.signal,
            });
            if (!chunkRes.ok) {
              const errBody = await chunkRes.json().catch(() => ({}));
              if (errBody.canFallbackToS3) throw new Error("Telegram upload failed; fallback to S3");
              if (attempt >= 2) throw new Error(`Chunk ${i} failed`);
            } else {
              success = true;
              uploadedBytes += chunkBlob.size;
              setProgress(Math.round((uploadedBytes / file.size) * 100));
            }
          } catch (err: unknown) {
            if (cancelRef.current || pauseRef.current) break;
            const e = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
            if (e.isCancelled) break;
            if (e.canFallbackToS3 && attempt >= 2) throw e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
        if (!success && !cancelRef.current && !pauseRef.current) {
          throw new Error(`Chunk ${i} failed after 3 attempts`);
        }
      }

      abortRef.current = null;
      controller.abort();

      if (cancelRef.current) {
        setStatus("idle");
        setProgress(0);
        return;
      }

      if (pauseRef.current) {
        setStatus("paused");
        return;
      }

      const completeRes = await fetch("/api/files/telegram/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      if (!completeRes.ok) throw new Error("Failed to complete upload");

      setProgress(100);
      setStatus("success");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: unknown) {
      const e = err as Error & { isCancelled?: boolean };
      if (e.isCancelled) return;
      setStatus("error");
      setError(e.message || "Upload failed");
      clearIntervals();
    }
  }, [currentFolderId, queryClient]);

  return {
    status,
    setStatus,
    progress,
    error,
    setError,
    duplicateFile,
    currentFileName,
    resumingId: null as string | null,
    setResumingId: () => {},
    cancelledIds,
    handleFile,
    cancelUpload,
    pauseUpload,
  };
}

function getChunkHash(blob: Blob): Promise<string> {
  return new Promise(async (resolve) => {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    resolve(Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join(""));
  });
}