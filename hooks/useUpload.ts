"use client";

import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getEncryptionPassphrase, deriveKey, encryptChunk } from "./useFileEncryption";

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

export type UploadEntry = {
  id: string;
  filename: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error: string;
  duplicateFile: FileType | null;
  fileId?: string;
};

type UploadMeta = {
  file: File;
  fileId: string;
  totalChunks: number;
  chunkSize: number;
  hash: string;
  encryptionSalt?: string;
  passphrase?: string | null;
};

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;

function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

let uploadIdCounter = 0;
function nextUploadId(): string {
  return `upload_${Date.now()}_${++uploadIdCounter}`;
}

export function useUpload(currentFolderId: string | null) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<UploadEntry[]>([]);

  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const pausedIds = useRef(new Set<string>());
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const uploadMeta = useRef<Map<string, UploadMeta>>(new Map());

  const cancelledIds = useRef(new Set<string>());

  const updateUpload = useCallback((id: string, patch: Partial<UploadEntry>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const cancelUpload = useCallback(() => {
    cancelRef.current = true;
    pauseRef.current = false;
    pausedIds.current.clear();
    for (const [id, ctrl] of abortControllers.current) {
      ctrl.abort();
    }
    abortControllers.current.clear();
    setUploads([]);
    uploadMeta.current.clear();
  }, []);

  const pauseUpload = useCallback(() => {
    setUploads((prev) => {
      for (const u of prev) {
        if (u.status === "uploading") pausedIds.current.add(u.id);
      }
      return prev.map((u) => (u.status === "uploading" ? { ...u, status: "paused" as const } : u));
    });
  }, []);

  const cancelSingleUpload = useCallback((id: string) => {
    const ctrl = abortControllers.current.get(id);
    if (ctrl) ctrl.abort();
    abortControllers.current.delete(id);
    uploadMeta.current.delete(id);
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const pauseSingleUpload = useCallback((id: string) => {
    pausedIds.current.add(id);
    setUploads((prev) =>
      prev.map((u) => (u.id === id && u.status === "uploading" ? { ...u, status: "paused" as const } : u))
    );
  }, []);

  const resumeSingleUpload = useCallback(async (id: string) => {
    const meta = uploadMeta.current.get(id);
    if (!meta) return;

    pausedIds.current.delete(id);
    updateUpload(id, { status: "uploading", progress: 0, error: "" });

    const { file, fileId, totalChunks, chunkSize, hash, encryptionSalt, passphrase } = meta;
    const controller = new AbortController();
    abortControllers.current.set(id, controller);

    try {
      // Fetch resume info from server to get already uploaded indexes
      const resumeRes = await fetch(`/api/files/telegram/${fileId}/resume`);
      let uploadedIndexes = new Set<number>();
      let uploadedBytes = 0;
      if (resumeRes.ok) {
        const resumeData = await resumeRes.json();
        uploadedIndexes = new Set<number>(resumeData.uploadedIndexes ?? []);
        uploadedBytes = resumeData.uploadedBytes ?? 0;
      }

      let cryptoKey: CryptoKey | null = null;
      if (passphrase && encryptionSalt) {
        const saltBuf = new Uint8Array(atob(encryptionSalt).length);
        const binary = atob(encryptionSalt);
        for (let i = 0; i < binary.length; i++) saltBuf[i] = binary.charCodeAt(i);
        cryptoKey = await deriveKey(passphrase, saltBuf);
      }

      for (let i = 0; i < totalChunks; i++) {
        if (cancelRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;

        if (uploadedIndexes.has(i)) continue;

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkBlob = file.slice(start, end);
        const chunkBuf = new Uint8Array(await chunkBlob.arrayBuffer());

        let dataToUpload: Blob;
        let chunkHash: string;
        let nonce: string | undefined;

        if (cryptoKey) {
          const { ciphertext, nonce: iv } = await encryptChunk(chunkBuf, cryptoKey);
          chunkHash = await crypto.subtle.digest("SHA-256", ciphertext as unknown as BufferSource).then(h => {
            const arr = new Uint8Array(h);
            return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
          });
          nonce = bufferToBase64(iv);
          dataToUpload = new Blob([ciphertext as unknown as BlobPart], { type: "application/octet-stream" });
        } else {
          chunkHash = await crypto.subtle.digest("SHA-256", chunkBuf as unknown as BufferSource).then(h => {
            const arr = new Uint8Array(h);
            return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
          });
          dataToUpload = chunkBlob;
        }

        const chunkForm = new FormData();
        chunkForm.append("fileId", fileId);
        chunkForm.append("chunkIndex", String(i));
        chunkForm.append("hash", chunkHash);
        chunkForm.append("chunk", dataToUpload);
        if (nonce) chunkForm.append("nonce", nonce);
        chunkForm.append("useEncryption", cryptoKey ? "false" : "true");

        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          if (cancelRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;
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
              updateUpload(id, { progress: Math.round((uploadedBytes / file.size) * 100) });
            }
          } catch (err: unknown) {
            if (cancelRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;
            const e = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
            if (e.isCancelled) break;
            if (e.canFallbackToS3 && attempt >= 2) throw e;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
        if (!success && !cancelRef.current && !pausedIds.current.has(id) && !controller.signal.aborted) {
          throw new Error(`Chunk ${i} failed after 3 attempts`);
        }
      }

      abortControllers.current.delete(id);

      if (cancelRef.current) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        return;
      }

      if (pausedIds.current.has(id)) {
        updateUpload(id, { status: "paused" });
        return;
      }

      const completeRes = await fetch("/api/files/telegram/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
        signal: controller.signal,
      });

      if (!completeRes.ok) throw new Error("Failed to complete upload");

      updateUpload(id, { status: "success", progress: 100 });
      uploadMeta.current.delete(id);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: unknown) {
      abortControllers.current.delete(id);
      const e = err as Error & { isCancelled?: boolean };
      if (e.isCancelled || controller.signal.aborted || pausedIds.current.has(id)) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        return;
      }
      updateUpload(id, { status: "error", error: e.message || "Upload failed" });
    }
  }, [queryClient, updateUpload]);

  const uploadChunks = useCallback(async (
    id: string,
    file: File,
    fileId: string,
    totalChunks: number,
    chunkSize: number,
    cryptoKey: CryptoKey | null,
    passphrase: string | null | undefined,
    encryptionSalt: string | undefined,
    controller: AbortController,
    existingUploadedBytes: number,
    existingUploadedIndexes: Set<number>,
  ) => {
    let uploadedBytes = existingUploadedBytes;

    for (let i = 0; i < totalChunks; i++) {
      if (cancelRef.current || pauseRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;

      if (existingUploadedIndexes.has(i)) continue;

      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunkBlob = file.slice(start, end);
      const chunkBuf = new Uint8Array(await chunkBlob.arrayBuffer());

      let dataToUpload: Blob;
      let chunkHash: string;
      let nonce: string | undefined;

      if (cryptoKey) {
        const { ciphertext, nonce: iv } = await encryptChunk(chunkBuf, cryptoKey);
        chunkHash = await crypto.subtle.digest("SHA-256", ciphertext as unknown as BufferSource).then(h => {
          const arr = new Uint8Array(h);
          return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
        });
        nonce = bufferToBase64(iv);
        dataToUpload = new Blob([ciphertext as unknown as BlobPart], { type: "application/octet-stream" });
      } else {
        chunkHash = await crypto.subtle.digest("SHA-256", chunkBuf as unknown as BufferSource).then(h => {
          const arr = new Uint8Array(h);
          return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
        });
        dataToUpload = chunkBlob;
      }

      const chunkForm = new FormData();
      chunkForm.append("fileId", fileId);
      chunkForm.append("chunkIndex", String(i));
      chunkForm.append("hash", chunkHash);
      chunkForm.append("chunk", dataToUpload);
      if (nonce) chunkForm.append("nonce", nonce);
      chunkForm.append("useEncryption", cryptoKey ? "false" : "true");

      let success = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        if (cancelRef.current || pauseRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;
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
            updateUpload(id, { progress: Math.round((uploadedBytes / file.size) * 100) });
          }
        } catch (err: unknown) {
          if (cancelRef.current || pauseRef.current || pausedIds.current.has(id) || controller.signal.aborted) break;
          const e = err as Error & { isCancelled?: boolean; canFallbackToS3?: boolean };
          if (e.isCancelled) break;
          if (e.canFallbackToS3 && attempt >= 2) throw e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
      if (!success && !cancelRef.current && !pauseRef.current && !pausedIds.current.has(id) && !controller.signal.aborted) {
        throw new Error(`Chunk ${i} failed after 3 attempts`);
      }
    }

    return uploadedBytes;
  }, [updateUpload]);

  const handleFile = useCallback(async (file: File, folderId?: string | null) => {
    const targetFolderId = folderId ?? currentFolderId;
    const id = nextUploadId();

    const entry: UploadEntry = {
      id,
      filename: file.name,
      size: file.size,
      status: "uploading",
      progress: 0,
      error: "",
      duplicateFile: null,
    };
    setUploads((prev) => [...prev, entry]);

    const passphrase = getEncryptionPassphrase();
    const controller = new AbortController();
    abortControllers.current.set(id, controller);

    try {
      const hash = await getFileHash(file);

      if (file.size <= SMALL_FILE_LIMIT) {
        const progressInterval = setInterval(() => {
          updateUpload(id, { progress: Math.min(85, entry.progress + 8) });
        }, 150);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("hash", hash);
        formData.append("folderId", targetFolderId ?? "");

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        clearInterval(progressInterval);

        if (res.status === 409) {
          const body = await res.json();
          updateUpload(id, { status: "duplicate", duplicateFile: body.existingFile, progress: 0 });
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(body.error || `Upload failed (${res.status})`);
        }

        updateUpload(id, { status: "success", progress: 100 });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        return;
      }

      // Large file: Telegram multipart upload
      let encryptionSalt: string | undefined;
      let useEncryption = false;

      if (passphrase) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        encryptionSalt = bufferToBase64(salt);
      } else {
        useEncryption = true;
      }

      const initRes = await fetch("/api/files/telegram/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          hash,
          folderId: targetFolderId,
          useEncryption,
          encryptionSalt,
        }),
        signal: controller.signal,
      });

      if (!initRes.ok) {
        const body = await initRes.json().catch(() => ({ error: "Init failed" }));
        throw new Error(body.error || "Failed to init upload");
      }

      const initData = await initRes.json();
      if (initData.isDuplicate) {
        updateUpload(id, { status: "duplicate", duplicateFile: initData.existingFile, progress: 0 });
        return;
      }

      const fileId = initData.fileId;
      const totalChunks = initData.totalChunks;
      const chunkSize = initData.chunkSize || 4 * 1024 * 1024;

      updateUpload(id, { fileId });

      uploadMeta.current.set(id, {
        file,
        fileId,
        totalChunks,
        chunkSize,
        hash,
        encryptionSalt,
        passphrase,
      });

      let cryptoKey: CryptoKey | null = null;
      if (passphrase && encryptionSalt) {
        const saltBuf = new Uint8Array(atob(encryptionSalt).length);
        const binary = atob(encryptionSalt);
        for (let i = 0; i < binary.length; i++) saltBuf[i] = binary.charCodeAt(i);
        cryptoKey = await deriveKey(passphrase, saltBuf);
      }

      const uploadedBytes = await uploadChunks(id, file, fileId, totalChunks, chunkSize, cryptoKey, passphrase, encryptionSalt, controller, 0, new Set());

      abortControllers.current.delete(id);

      if (cancelRef.current) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        uploadMeta.current.delete(id);
        return;
      }

      if (pauseRef.current || pausedIds.current.has(id)) {
        updateUpload(id, { status: "paused" });
        return;
      }

      const completeRes = await fetch("/api/files/telegram/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
        signal: controller.signal,
      });

      if (!completeRes.ok) throw new Error("Failed to complete upload");

      updateUpload(id, { status: "success", progress: 100 });
      uploadMeta.current.delete(id);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err: unknown) {
      abortControllers.current.delete(id);
      const e = err as Error & { isCancelled?: boolean };
      if (e.isCancelled || controller.signal.aborted) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        uploadMeta.current.delete(id);
        return;
      }
      updateUpload(id, { status: "error", error: e.message || "Upload failed" });
    }
  }, [currentFolderId, queryClient, updateUpload, uploadChunks]);

  const getFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  return {
    uploads,
    cancelledIds,
    handleFile,
    cancelUpload,
    cancelSingleUpload,
    pauseUpload,
    pauseSingleUpload,
    resumeSingleUpload,
  };
}
