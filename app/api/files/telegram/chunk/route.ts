import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { sendDocument, deleteMessage } from "@/adapters/storage/telegram";
import { encryptChunkWithNonce, generateNonce } from "@/server/services/encryptionService";
import { computeHash } from "@/server/lib/hash";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const _token = process.env.TELEGRAM_BOT_TOKEN;
  const _channel = process.env.TELEGRAM_CHANNEL_ID;
  const _apiUrl = process.env.TELEGRAM_BOT_API_URL;
  console.log(`[telegram/chunk] token=${_token ? _token.slice(0,8)+'...' : 'MISSING'} channel=${_channel || 'MISSING'} apiUrl=${_apiUrl || 'MISSING'}`);

  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const fileId = form.get("fileId") as string;
  const chunkIndexStr = form.get("chunkIndex") as string;
  const hash = form.get("hash") as string;
  const plaintextHash = form.get("plaintextHash") as string;
  const nonce = form.get("nonce") as string;
  const chunkFile = form.get("chunk") as Blob | null;
  const useEncryption = form.get("useEncryption") === "true";

  if (!fileId || !chunkIndexStr || !hash || !chunkFile) {
    return NextResponse.json({ error: "fileId, chunkIndex, hash, and chunk are required" }, { status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.backend !== "telegram") {
    return NextResponse.json({ error: "File is no longer using Telegram backend" }, { status: 409 });
  }

  if (!["pending", "uploading", "paused"].includes(file.status)) {
    return NextResponse.json({ error: "File is not accepting Telegram chunks" }, { status: 409 });
  }

  if (file.status === "pending" || file.status === "paused") {
    file.status = "uploading";
    await file.save();
  }

  const exists = await TelegramChunk.findOne({ fileId, chunkIndex });
  if (exists) {
    return NextResponse.json({ message: "Chunk already uploaded" });
  }

  const chunkBuffer = Buffer.from(await chunkFile.arrayBuffer());
  
  let encryptedChunk: Buffer;
  let chunkNonce: string;
  let chunkPlaintextHash: string;

  if (useEncryption && file.encryptionKey) {
    const key = Buffer.from(file.encryptionKey, "base64");
    const nonceToUse = nonce ? Buffer.from(nonce, "base64") : generateNonce();
    chunkNonce = nonceToUse.toString("base64");
    
    const encrypted = encryptChunkWithNonce(chunkBuffer, nonceToUse, key);
    encryptedChunk = Buffer.concat([nonceToUse, encrypted]);
    chunkPlaintextHash = plaintextHash || computeHash(chunkBuffer);
  } else {
    encryptedChunk = chunkBuffer;
    chunkNonce = nonce || "";
    chunkPlaintextHash = plaintextHash || hash;
  }

  const encryptedHash = computeHash(encryptedChunk);
  const filename = `${file.filename}.part${chunkIndex}`;

  let lastError: Error | null = null;
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const blob = new Blob([new Uint8Array(encryptedChunk)], { type: "application/octet-stream" });
      const { messageId, fileId: tgFileId } = await sendDocument(blob, filename);

      try {
        await TelegramChunk.create({
          fileId,
          chunkIndex,
          hash: encryptedHash,
          plaintextHash: chunkPlaintextHash,
          nonce: chunkNonce,
          size: encryptedChunk.length,
          telegramMessageId: messageId,
          telegramFileId: tgFileId,
        });
      } catch (dbErr: any) {
        if (dbErr?.code === 11000) {
          await deleteMessage(messageId);
          return NextResponse.json({ message: "Chunk already recorded" });
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
      });
    } catch (err: any) {
      lastError = err;
      if (err.code === 429) {
        if (attempt < delays.length) {
          await sleep(delays[attempt]);
          continue;
        }
      } else {
        console.error(`[telegram/chunk] Chunk ${chunkIndex} (attempt ${attempt}):`, err);
        return NextResponse.json(
          { error: `Telegram upload failed: ${err?.message || String(err)}` },
          { status: 500 },
        );
      }
    }
  }

  await File.findByIdAndUpdate(fileId, {
    $set: {
      status: "paused",
      lastError: `Chunk ${chunkIndex} failed after retries: ${lastError?.message ?? "Unknown error"}`,
    },
  });

  return NextResponse.json(
    {
      error: `Chunk ${chunkIndex} failed after retries: ${lastError?.message}`,
      chunkIndex,
      canFallbackToS3: true,
    },
    { status: 503 },
  );
}