import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { sendDocument, deleteMessage } from "@/adapters/storage/telegram";
import { encryptChunkWithNonce } from "@/server/services/encryptionService";
import { generateNonce as generateNonceFromService } from "@/server/services/encryptionService";
import { computeHash } from "@/server/lib/hash";
import crypto from "crypto";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const _token = process.env.TELEGRAM_BOT_TOKEN;
  const _channel = process.env.TELEGRAM_CHANNEL_ID;
  const _apiUrl = process.env.TELEGRAM_BOT_API_URL;
  
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized - please login", status: 401 });
  }

  const form = await req.formData();
  const fileId = form.get("fileId") as string;
  const chunkIndexStr = form.get("chunkIndex") as string;
  const hash = form.get("hash") as string;
  const plaintextHash = form.get("plaintextHash") as string;
  const nonce = form.get("nonce") as string;
  const chunkFile = form.get("chunk") as Blob | null;
  const useEncryption = form.get("useEncryption") === "true";

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required", status: 400 });
  }
  if (!chunkIndexStr) {
    return NextResponse.json({ error: "chunkIndex is required", status: 400 });
  }
  if (!hash) {
    return NextResponse.json({ error: "hash is required", status: 400 });
  }
  if (!chunkFile) {
    return NextResponse.json({ error: "chunk file is required", status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: "Invalid chunkIndex", status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found", status: 404 });
  }
  if (file.owner_email !== user.email) {
    return NextResponse.json({ error: "Forbidden - not your file", status: 403 });
  }

  if (file.backend !== "telegram") {
    return NextResponse.json({ error: "File is not using Telegram backend", status: 409 });
  }

  if (!["pending", "uploading", "paused"].includes(file.status)) {
    return NextResponse.json({ 
      error: `File is in "${file.status}" state and cannot accept chunks`, 
      status: 409 
    });
  }

  if (file.status === "pending" || file.status === "paused") {
    file.status = "uploading";
    await file.save();
  }

  const existingChunk = await TelegramChunk.findOne({ fileId, chunkIndex });
  if (existingChunk) {
    return NextResponse.json({ 
      message: "Chunk already uploaded",
      chunkIndex,
      telegramFileId: existingChunk.telegramFileId,
    });
  }

  const chunkBuffer = Buffer.from(await chunkFile.arrayBuffer());
  
  let encryptedChunk: Buffer;
  let chunkNonce: string;
  let chunkPlaintextHash: string;

  // Always generate a nonce to satisfy the schema requirement
  const nonceValue = nonce || crypto.randomBytes(12).toString("base64");

  if (useEncryption && file.encryptionKey) {
    const key = Buffer.from(file.encryptionKey, "base64");
    if (key.length !== 32) {
      return NextResponse.json({ error: `Invalid key length: ${key.length}`, status: 500 });
    }
    const nonceToUse = nonce ? Buffer.from(nonce, "base64") : crypto.randomBytes(12);
    chunkNonce = nonceToUse.toString("base64");
    
    try {
      const encrypted = encryptChunkWithNonce(chunkBuffer, nonceToUse, key);
      encryptedChunk = encrypted;
    } catch (encErr) {
      return NextResponse.json({ error: `Encryption failed: ${encErr instanceof Error ? encErr.message : String(encErr)}`, status: 500 });
    }
    chunkPlaintextHash = plaintextHash || computeHash(chunkBuffer);
  } else {
    encryptedChunk = chunkBuffer;
    chunkNonce = nonceValue;
    chunkPlaintextHash = plaintextHash || hash;
  }

  const encryptedHash = computeHash(encryptedChunk);
  const filename = `${file.filename}.part${chunkIndex}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const blob = new Blob([new Uint8Array(encryptedChunk)], { type: "application/octet-stream" });
      const { messageId, fileId: tgFileId } = await sendDocument(blob, filename);

      try {
        const finalNonce = chunkNonce || crypto.randomBytes(12).toString("base64");
        if (!finalNonce) {
          throw new Error("Failed to generate nonce for chunk");
        }
        await TelegramChunk.create({
          fileId,
          chunkIndex,
          hash: encryptedHash,
          plaintextHash: chunkPlaintextHash,
          nonce: finalNonce,
          size: encryptedChunk.length,
          telegramMessageId: messageId,
          telegramFileId: tgFileId,
        });
      } catch (dbErr: any) {
        if (dbErr?.code === 11000) {
          await deleteMessage(messageId);
          return NextResponse.json({ 
            message: "Chunk already recorded",
            chunkIndex,
            telegramFileId: dbErr?.telegramFileId || tgFileId,
          });
        }
        await deleteMessage(messageId);
        throw dbErr;
      }

      return NextResponse.json({ 
        messageId, 
        fileId: tgFileId,
        chunkIndex,
        hash: encryptedHash,
        plaintextHash: chunkPlaintextHash,
        nonce: chunkNonce,
        size: encryptedChunk.length,
      });
    } catch (err: any) {
      lastError = err;
      
      if (err?.code === 429) {
        if (attempt < RETRY_DELAYS.length - 1) {
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
      }
      
      const errorMessage = err?.message || String(err) || "Unknown error";
      console.error(`[telegram/chunk] Chunk ${chunkIndex} failed:`, errorMessage);
      
      return NextResponse.json({
        error: `Upload failed: ${errorMessage}`,
        chunkIndex,
        canFallbackToS3: true,
        attempt: attempt + 1,
        maxAttempts: MAX_RETRIES,
      }, { status: 503 });
    }
  }

  await File.findByIdAndUpdate(fileId, {
    $set: {
      status: "paused",
      lastError: `Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown error"}`,
    },
  });

  return NextResponse.json({
    error: `Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries`,
    chunkIndex,
    canFallbackToS3: true,
    lastError: lastError?.message,
  }, { status: 503 });
}