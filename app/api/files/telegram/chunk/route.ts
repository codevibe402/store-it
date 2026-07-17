import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { sendDocument, deleteMessage } from "@/adapters/storage/telegram";
import { encryptChunkWithNonce } from "@/server/services/encryptionService";
import { computeHash } from "@/server/lib/hash";
import { canUploadToFile } from "@/server/services/uploadAccess";
import crypto from "crypto";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized - please login", status: 401 });
  }

  const form = await req.formData();
  const fileId = form.get("fileId") as string;
  const chunkIndexStr = form.get("chunkIndex") as string;
  const hash = form.get("hash") as string;
  const nonce = form.get("nonce") as string;
  const chunkFile = form.get("chunk") as Blob | null;

  if (!fileId || !chunkIndexStr || !hash || !chunkFile) {
    return NextResponse.json({ error: "fileId, chunkIndex, hash, and chunk are required", status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: "Invalid chunkIndex", status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) return NextResponse.json({ error: "File not found", status: 404 });
  // Re-checked on every single chunk, not just once at init — the
  // permission-revoked-mid-upload and folder-moved/ownership-transferred
  // -mid-upload requirements both need this to be live, not cached from
  // whatever was true when the upload started.
  if (!(await canUploadToFile(user.userId, file))) {
    return NextResponse.json({ error: "Forbidden", status: 403 }, { status: 403 });
  }
  if (file.backend !== "telegram") return NextResponse.json({ error: "File is not using Telegram backend", status: 409 });
  if (!["pending", "uploading", "paused"].includes(file.status)) {
    return NextResponse.json({ error: `File is in "${file.status}" state`, status: 409 });
  }

  if (file.status === "pending" || file.status === "paused") {
    file.status = "uploading";
    await file.save();
  }

  const existingChunk = await TelegramChunk.findOne({ fileId, chunkIndex });
  if (existingChunk) {
    return NextResponse.json({ message: "Chunk already uploaded", chunkIndex, telegramFileId: existingChunk.telegramFileId });
  }

  const chunkBuffer = Buffer.from(await chunkFile.arrayBuffer());

  // Client already disconnected (e.g. genuine cancel, which does abort
  // in-flight requests) — no point spending a Telegram API call + DB write
  // on a response nobody will read.
  if (req.signal.aborted) {
    return NextResponse.json({ error: "Request aborted" }, { status: 499 });
  }

  // Backward compat: if file has server-side encryptionKey, encrypt on server (old method)
  let dataToStore: Buffer;
  let chunkNonce: string;
  let storedHash: string;

  if (file.encryptionKey) {
    const key = Buffer.from(file.encryptionKey, "base64");
    const nonceToUse = nonce ? Buffer.from(nonce, "base64") : crypto.randomBytes(12);
    chunkNonce = nonceToUse.toString("base64");
    dataToStore = encryptChunkWithNonce(chunkBuffer, nonceToUse, key);
    storedHash = computeHash(dataToStore);
  } else {
    // New zero-knowledge mode: client already encrypted, store as-is
    dataToStore = chunkBuffer;
    chunkNonce = nonce || crypto.randomBytes(12).toString("base64");
    storedHash = hash;
  }

  const filename = `chunk_${chunkIndex}.bin`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const blob = new Blob([new Uint8Array(dataToStore)], { type: "application/octet-stream" });
      const { messageId, fileId: tgFileId } = await sendDocument(blob, filename);

      try {
        await TelegramChunk.create({
          fileId,
          chunkIndex,
          hash: storedHash,
          plaintextHash: hash,
          nonce: chunkNonce,
          size: dataToStore.length,
          telegramMessageId: messageId,
          telegramFileId: tgFileId,
        });
      } catch (dbErr: any) {
        if (dbErr?.code === 11000) {
          await deleteMessage(messageId);
          return NextResponse.json({ message: "Chunk already recorded", chunkIndex, telegramFileId: dbErr?.telegramFileId || tgFileId });
        }
        await deleteMessage(messageId);
        throw dbErr;
      }

      return NextResponse.json({ messageId, fileId: tgFileId, chunkIndex, hash: storedHash, nonce: chunkNonce, size: dataToStore.length });
    } catch (err: any) {
      lastError = err;
      if (err?.code === 429 && attempt < RETRY_DELAYS.length - 1) {
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      return NextResponse.json({ error: `Upload failed: ${err?.message || "Unknown"}`, chunkIndex, canFallbackToS3: true }, { status: 503 });
    }
  }

  await File.findByIdAndUpdate(fileId, { $set: { status: "paused", lastError: `Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown"}` } });
  return NextResponse.json({ error: `Chunk ${chunkIndex} failed`, canFallbackToS3: true }, { status: 503 });
}