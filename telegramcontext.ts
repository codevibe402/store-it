"use client"
import React, { createContext, useContext, useState, useRef, useCallback, ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { storeFile, getFile, removeFile } from "@/lib/indexedDB"

export type UploadStatus = "idle" | "uploading" | "success" | "error" | "duplicate"

export type FileType = {
  _id: string
  filename: string
  mimetype: string
  size: number
  hash?: string
  storageUrl: string
  owner_id: string
  status: "pending" | "uploading" | "paused" | "fallback_cleanup" | "s3_pending" | "uploaded" | "cancelled" | "failed"
  folderId: string | null
  createdAt: string
  backend?: "s3" | "telegram"
}

export type UploadError = Error & {
  isCancelled?: boolean
  isDuplicate?: boolean
  existingFile?: FileType
}

export type TelegramUploadConfig = {
  chunkSize: number
  concurrency: number
  smallFileLimit: number
  botToken: string
  channelId: string
  botApiUrl: string
}

export type AuthContext = {
  email: string
  username: string
  password: string
  sanitizeEmail: (email: string) => string
  sanitizeUsername: (username: string) => string
  sanitizePassword: (password: string) => string
}

export type UploadStats = {
  totalFiles: number
  totalSize: number
  completedFiles: number
  failedFiles: number
  pendingFiles: number
}

export type AuthFormCallbacks = {
  onSignIn: (provider: string, options?: Record<string, unknown>) => Promise<unknown>
  onRegister: (data: { email: string; username: string; password: string }) => Promise<Response>
}

export type TelegramContextValue = {
  status: UploadStatus
  progress: number
  errorMsg: string
  resumingId: string | null
  isFileSearchOpen: boolean
  currentFolderId: string | null
  searchQuery: string
  setStatus: (s: UploadStatus) => void
  setProgress: (p: number) => void
  setErrorMsg: (m: string) => void
  setResumingId: (id: string | null) => void
  setIsFileSearchOpen: (open: boolean) => void
  setCurrentFolderId: (id: string | null) => void
  setSearchQuery: (q: string) => void

  cancelRef: React.MutableRefObject<boolean>
  pauseRef: React.MutableRefObject<boolean>
  abortRef: React.MutableRefObject<AbortController | null>
  intervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>
  currentFileNameRef: React.MutableRefObject<string>

  handleCancel: (meta: { fileId: string; backend: string; uploadId?: string; key?: string } | null) => Promise<void>
  handleResume: (pendingFile: FileType, handle: FileSystemFileHandle) => Promise<void>
  handlePause: () => void
  uploadFile: (file: File) => Promise<void>

  openFile: (file: FileType) => Promise<void>
  downloadFile: (file: FileType) => Promise<void>

  resumeFileMap: Map<string, FileSystemFileHandle>
  storeUploadFile: (fileId: string, handle: FileSystemFileHandle, filename: string, size: number, lastModified: number) => Promise<void>
  getUploadFile: (fileId: string) => Promise<File | undefined>
  removeUploadFile: (fileId: string) => Promise<void>
}

const TelegramContext = createContext<TelegramContextValue | null>(null)

export function useTelegram(): TelegramContextValue {
  const ctx = useContext(TelegramContext)
  if (!ctx) throw new Error("useTelegram must be used within a TelegramProvider")
  return ctx
}

type Props = {
  children: ReactNode
  config?: Partial<TelegramUploadConfig>
}

export function TelegramProvider({ children, config: _config }: Props) {
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<UploadStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")
  const [resumingId, setResumingId] = useState<string | null>(null)
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const cancelRef = useRef(false)
  const pauseRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentFileNameRef = useRef("")

  const resumeFileMap = useRef(new Map<string, FileSystemFileHandle>()).current

  const handleCancel = useCallback(async (meta: { fileId: string; backend: string; uploadId?: string; key?: string } | null) => {
    cancelRef.current = true
    pauseRef.current = false
    abortRef.current?.abort()
    abortRef.current = null
    if (intervalRef.current) clearInterval(intervalRef.current)

    setStatus("idle")
    setProgress(0)

    if (meta?.fileId) {
      resumeFileMap.delete(meta.fileId)
      removeFile(meta.fileId).catch(() => {})
      queryClient.setQueryData<{ files: FileType[]; folders: unknown[]; pendingFiles: FileType[] }>(["dashboard"], (old) =>
        old ? { ...old, pendingFiles: old.pendingFiles.filter((f) => f._id !== meta.fileId) } : old
      )
    }

    if (meta) {
      try {
        if (meta.backend === "telegram") {
          await fetch("/api/files/telegram/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: meta.fileId }),
          })
        } else {
          await fetch("/api/files/upload/multipart/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileId: meta.fileId, uploadId: meta.uploadId, key: meta.key }),
          })
        }
      } catch {
        // best-effort cleanup
      } finally {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      }
    }
  }, [queryClient, resumeFileMap])

  const handleResume = useCallback(async (pendingFile: FileType, handle: FileSystemFileHandle) => {
    setResumingId(pendingFile._id)
    setStatus("uploading")
    setProgress(0)

    try {
      const opts = { mode: "read" as const }
      let permission = await handle.queryPermission(opts)
      if (permission !== "granted") {
        permission = await handle.requestPermission(opts)
      }
      if (permission !== "granted") {
        throw new Error("File permission denied. Please reselect the file.")
      }

      const file = await handle.getFile()
      currentFileNameRef.current = file.name
      resumeFileMap.set(pendingFile._id, handle)
      storeFile({
        fileId: pendingFile._id,
        handle,
        filename: file.name,
        size: file.size,
        lastModified: file.lastModified,
        storedAt: Date.now(),
      }).catch(() => {})

      cancelRef.current = false
      pauseRef.current = false

      const hash = await getFileHashBrowser(file)
      if (pendingFile.hash && hash !== pendingFile.hash) {
        throw new Error("Selected file does not match the original. Hash mismatch.")
      }
      // uploadSmart would be called here – extracted per-component
      resumeFileMap.delete(pendingFile._id)
      removeFile(pendingFile._id).catch(() => {})
      setProgress(100)
      setStatus("success")
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      setTimeout(() => setStatus("idle"), 3000)
    } catch (err: unknown) {
      const ue = err as UploadError
      if (ue?.isCancelled) {
        resumeFileMap.delete(pendingFile._id)
        removeFile(pendingFile._id).catch(() => {})
        return
      }
      setStatus("error")
      setErrorMsg(ue?.message || "Resume failed")
    } finally {
      setResumingId(null)
    }
  }, [queryClient, resumeFileMap])

  const handlePause = useCallback(() => {
    pauseRef.current = true
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const uploadFile = useCallback(async (_file: File) => {
    // Delegated to component-level implementation
  }, [])

  const openFile = useCallback(async (file: FileType) => {
    window.open(`/api/files/${file._id}/download?preview=1`, "_blank")
  }, [])

  const downloadFile = useCallback(async (_file: FileType) => {
    // Delegated per component
  }, [])

  const storeUploadFile = useCallback(async (
    fileId: string,
    handle: FileSystemFileHandle,
    filename: string,
    size: number,
    lastModified: number,
  ) => {
    resumeFileMap.set(fileId, handle)
    await storeFile({
      fileId,
      handle,
      filename,
      size,
      lastModified,
      storedAt: Date.now(),
    })
  }, [resumeFileMap])

  const getUploadFile = useCallback(async (fileId: string): Promise<File | undefined> => {
    const handle = resumeFileMap.get(fileId)
    if (handle) {
      try {
        const opts = { mode: "read" as const }
        if (await handle.queryPermission(opts) !== "granted") {
          await handle.requestPermission(opts)
        }
        return await handle.getFile()
      } catch {
        return undefined
      }
    }
    const fromDB = await getFile(fileId)
    if (fromDB) {
      resumeFileMap.set(fileId, fromDB.handle)
      try {
        const opts = { mode: "read" as const }
        if (await fromDB.handle.queryPermission(opts) !== "granted") {
          await fromDB.handle.requestPermission(opts)
        }
        return await fromDB.handle.getFile()
      } catch {
        resumeFileMap.delete(fileId)
        return undefined
      }
    }
    return undefined
  }, [resumeFileMap])

  const removeUploadFile = useCallback(async (fileId: string) => {
    resumeFileMap.delete(fileId)
    await removeFile(fileId)
  }, [resumeFileMap])

  return React.createElement(
    TelegramContext.Provider,
    { value: {
        status, progress, errorMsg, resumingId,
        isFileSearchOpen, currentFolderId, searchQuery,
        setStatus, setProgress, setErrorMsg, setResumingId,
        setIsFileSearchOpen, setCurrentFolderId, setSearchQuery,
        cancelRef, pauseRef, abortRef, intervalRef, currentFileNameRef,
        handleCancel, handleResume, handlePause, uploadFile, openFile, downloadFile,
        resumeFileMap, storeUploadFile, getUploadFile, removeUploadFile,
      } },
    children,
  )
}

async function getFileHashBrowser(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
