import { decryptChunk } from "@/server/services/decryptionService";
import { downloadTelegramChunk } from "@/server/services/storageService";
import { parseNonce } from "@/server/lib/crypto";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import File from "@/adapters/database/models/File";
import FileVersionModel from "@/adapters/database/models/FileVersion";
import EncryptionKeyModel from "@/adapters/database/models/EncryptionKey";
import connectDB from "@/adapters/database/mongoose";

const PREFETCH = 4;

export interface DownloadOptions {
  fileId: string;
  versionId?: string;
  userId?: string;
}

export interface DownloadResult {
  stream: ReadableStream<Uint8Array>;
  size: number;
  mimetype: string;
  filename: string;
  encryptionKeyBase64?: string;
}

export async function createTelegramDownloadStreaming(options: DownloadOptions): Promise<DownloadResult> {
  const { fileId, versionId } = options;

  await connectDB();

  const file = await File.findById(fileId).lean();
  if (!file) throw new Error("File not found");

  if (options.userId) {
    if (file.owner_id.toString() !== options.userId) {
      throw new Error("Forbidden");
    }
  }

  const version = versionId
    ? await FileVersionModel.findById(versionId).lean()
    : file.currentVersionId
      ? await FileVersionModel.findById(file.currentVersionId).lean()
      : null;

  if (!version) throw new Error("Version not found");

  if (version.backend !== "telegram") {
    throw new Error("File is not stored in Telegram");
  }

  const chunks = await TelegramChunk.find({ versionId: version._id })
    .sort({ chunkIndex: 1 })
    .lean();

  const totalChunks = chunks.length;
  const fetchQueue = new Map<number, Promise<Buffer>>();

  function startFetch(index: number) {
    if (index >= totalChunks || fetchQueue.has(index)) return;
    const chunk = chunks[index];
    fetchQueue.set(
      index,
      downloadTelegramChunk(chunk.telegramFileId),
    );
  }

  for (let i = 0; i < Math.min(PREFETCH, totalChunks); i++) {
    startFetch(i);
  }

  let idx = 0;
  let decryptionKey: Buffer | null = null;

  const stream = new ReadableStream({
    async pull(controller: ReadableStreamDefaultController) {
      if (idx >= totalChunks) {
        controller.close();
        return;
      }

      startFetch(idx + PREFETCH);

      try {
        const data = await fetchQueue.get(idx)!;
        fetchQueue.delete(idx);

        // Backward compat: decrypt with server-side key if present (old files)
        if (decryptionKey === null && file.encryptionKey) {
          const keyDoc = await EncryptionKeyModel.findOne({ fileId: file._id }).lean();
          if (keyDoc) {
            decryptionKey = Buffer.from(keyDoc.keyBase64, "base64");
          }
        }

        if (decryptionKey) {
          const nonce = parseNonce(chunks[idx].nonce);
          if (nonce.length > 0) {
            const decrypted = decryptChunk(Buffer.from(data), nonce, decryptionKey);
            controller.enqueue(new Uint8Array(decrypted));
          } else {
            controller.enqueue(new Uint8Array(data));
          }
        } else {
          // New zero-knowledge mode: stream encrypted data as-is
          controller.enqueue(new Uint8Array(data));
        }

        idx++;
      } catch (err) {
        controller.error(err as Error);
      }
    },
  });

  return {
    stream,
    size: version.size,
    mimetype: version.mimetype,
    filename: file.filename,
    encryptionKeyBase64: undefined,
  };
}