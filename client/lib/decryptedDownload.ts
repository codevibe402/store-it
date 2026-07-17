import { decryptChunk, base64ToBuffer } from "@/hooks/useFileEncryption"

export interface FileManifest {
  requiresClientDecrypt: boolean
  versionId?: string
  filename?: string
  mimetype?: string
  totalSize?: number
  chunks?: { index: number; nonce: string; size: number }[]
}

export async function fetchManifest(fileId: string): Promise<FileManifest> {
  const res = await fetch(`/api/files/${fileId}/manifest`)
  if (!res.ok) throw new Error("Failed to load file manifest")
  return res.json()
}

export async function fetchAndDecryptFile(
  fileId: string,
  manifest: FileManifest,
  dek: CryptoKey,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (!manifest.requiresClientDecrypt || !manifest.versionId || !manifest.chunks) {
    throw new Error("File does not require client-side decryption")
  }

  const { versionId, chunks, mimetype, totalSize } = manifest
  const parts: Uint8Array[] = new Array(chunks.length)
  let bytesDone = 0

  // Modest bounded concurrency, mirroring the prefetch pattern already used
  // for server-side Telegram streaming elsewhere in this codebase.
  const CONCURRENCY = 4
  let nextIndex = 0

  async function worker() {
    while (nextIndex < chunks.length) {
      const i = nextIndex++
      const chunk = chunks[i]

      const res = await fetch(`/api/files/${fileId}/chunk-data/${chunk.index}?versionId=${versionId}`)
      if (!res.ok) throw new Error(`Failed to fetch chunk ${chunk.index}`)
      const ciphertext = new Uint8Array(await res.arrayBuffer())
      const nonce = base64ToBuffer(chunk.nonce)
      const plaintext = await decryptChunk(ciphertext, dek, nonce)

      parts[i] = plaintext
      bytesDone += chunk.size
      if (totalSize) onProgress?.(Math.round((bytesDone / totalSize) * 100))
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()))

  return new Blob(parts as BlobPart[], { type: mimetype || "application/octet-stream" })
}
