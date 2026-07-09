import { NextRequest } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import EncryptionKeyModel from "@/adapters/database/models/EncryptionKey";
import { getFile, getFileDownloadUrl } from "@/adapters/storage/telegram";
import { decryptChunk } from "@/server/services/decryptionService";
import { parseNonce } from "@/server/lib/crypto";
import { computeHash } from "@/server/lib/hash";

const PREFETCH = 4;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getAuthUser();
  if (!user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId } = await params;
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) return new Response("File not found", { status: 404 });
  if (file.owner_email !== user.email) return new Response("Forbidden", { status: 403 });
  if (file.backend !== "telegram") return new Response("File is not stored in Telegram", { status: 409 });
  if (file.status !== "uploaded") return new Response("File not fully uploaded yet", { status: 400 });

  const chunks = await TelegramChunk.find({ fileId }).sort({ chunkIndex: 1 }).lean();
  const totalChunks = chunks.length;

  const encryptionKey = file.encryptionKey
    ? Buffer.from(file.encryptionKey, "base64")
    : null;

  const encryptionKeyDoc = await EncryptionKeyModel.findOne({ fileId }).lean();
  const key = encryptionKeyDoc?.keyBase64;

  const fetchQueue = new Map<number, Promise<Buffer>>();

  function startFetch(index: number) {
    if (index >= totalChunks || fetchQueue.has(index)) return;
    const chunk = chunks[index];
    fetchQueue.set(
      index,
      (async () => {
        const { filePath } = await getFile(chunk.telegramFileId);
        const url = getFileDownloadUrl(filePath);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download chunk ${index}`);
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      })(),
    );
  }

  for (let i = 0; i < Math.min(PREFETCH, totalChunks); i++) startFetch(i);

  let idx = 0;

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

        const nonce = chunks[idx].nonce ? parseNonce(chunks[idx].nonce) : null;
        
        let decrypted: Buffer;
        if (key && nonce && nonce.length > 0) {
          const keyBuffer = Buffer.from(key, "base64");
          decrypted = decryptChunk(data, nonce, keyBuffer);
        } else {
          decrypted = data;
        }

        if (chunks[idx].hash) {
          const computedHash = computeHash(data);
          if (computedHash !== chunks[idx].hash) {
            controller.error(new Error(`Chunk ${idx} integrity check failed`));
            return;
          }
        }

        controller.enqueue(new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength));
        idx++;
      } catch (err) {
        controller.error(err as Error);
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": file.mimetype || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Content-Length": file.size.toString(),
  };

  return new Response(stream, {
    status: 200,
    headers,
  });
}