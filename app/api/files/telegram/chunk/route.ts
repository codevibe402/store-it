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
// Never block a single invocation waiting on Telegram's own requested
// retry_after longer than this, even if it asks for more — better to fail
// fast and let the client fall back to S3 than sleep past whatever
// execution-time budget this route is actually running under.
const MAX_RETRY_AFTER_MS = 8000;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  // Coarse phase timing, logged once per request — added specifically to
  // answer "is the slowness Telegram's own response time, or something in
  // this route" with a number instead of a guess. Safe to leave in
  // permanently: it's a handful of Date.now() calls and one console.log,
  // not meaningful overhead next to a real network call to Telegram.
  const tStart = Date.now();
  let tAfterAccessChecks = 0;
  let tAfterEncryption = 0;

  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized - please login" }, { status: 401 });
  }

  const form = await req.formData();
  const fileId = form.get("fileId") as string;
  const chunkIndexStr = form.get("chunkIndex") as string;
  const hash = form.get("hash") as string;
  const nonce = form.get("nonce") as string;
  const chunkFile = form.get("chunk") as Blob | null;

  if (!fileId || !chunkIndexStr || !hash || !chunkFile) {
    return NextResponse.json({ error: "fileId, chunkIndex, hash, and chunk are required" }, { status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: "Invalid chunkIndex" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    console.warn(`[POST /api/files/telegram/chunk] file ${fileId} not found (chunk ${chunkIndex})`);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  // Re-checked on every single chunk, not just once at init — the
  // permission-revoked-mid-upload and folder-moved/ownership-transferred
  // -mid-upload requirements both need this to be live, not cached from
  // whatever was true when the upload started.
  if (!(await canUploadToFile(user.userId, file))) {
    console.warn(`[POST /api/files/telegram/chunk] forbidden: user ${user.userId} may not upload to file ${fileId}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (file.backend !== "telegram") {
    // Reachable if the client still holds stale Telegram upload metadata
    // for a file whose backend was already switched to S3 by the
    // fallback-to-s3 route (e.g. a resume/retry click after a failed S3
    // fallback attempt). Must be a real non-2xx status — a previous
    // version of this branch returned 200 here, which made the client's
    // `!chunkRes.ok` check silently treat the rejection as a successful
    // chunk upload.
    console.warn(`[POST /api/files/telegram/chunk] rejected: file ${fileId} backend is "${file.backend}", not telegram (chunk ${chunkIndex})`);
    return NextResponse.json({ error: "File is not using Telegram backend" }, { status: 409 });
  }
  if (!["pending", "uploading", "paused"].includes(file.status)) {
    console.warn(`[POST /api/files/telegram/chunk] rejected: file ${fileId} is in "${file.status}" state (chunk ${chunkIndex})`);
    return NextResponse.json({ error: `File is in "${file.status}" state` }, { status: 409 });
  }

  if (file.status === "pending" || file.status === "paused") {
    file.status = "uploading";
    await file.save();
  }

  const existingChunk = await TelegramChunk.findOne({ fileId, chunkIndex });
  if (existingChunk) {
    return NextResponse.json({ message: "Chunk already uploaded", chunkIndex, telegramFileId: existingChunk.telegramFileId });
  }

  tAfterAccessChecks = Date.now();

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

  tAfterEncryption = Date.now();

  const filename = `chunk_${chunkIndex}.bin`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const blob = new Blob([new Uint8Array(dataToStore)], { type: "application/octet-stream" });
      const tSendStart = Date.now();
      const { messageId, fileId: tgFileId } = await sendDocument(blob, filename);
      const tSendDone = Date.now();

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
        console.error(`[POST /api/files/telegram/chunk] failed to record chunk ${chunkIndex} for file ${fileId} after Telegram send succeeded; deleting orphaned Telegram message`, dbErr);
        await deleteMessage(messageId);
        throw dbErr;
      }

      const tDone = Date.now();
      console.log(
        `[telegram/chunk timing] file=${fileId} chunk=${chunkIndex} attempt=${attempt + 1} ` +
        `total=${tDone - tStart}ms accessChecks=${tAfterAccessChecks - tStart}ms ` +
        `readAndEncrypt=${tAfterEncryption - tAfterAccessChecks}ms sendDocument=${tSendDone - tSendStart}ms ` +
        `dbWrite=${tDone - tSendDone}ms`
      );

      return NextResponse.json({ messageId, fileId: tgFileId, chunkIndex, hash: storedHash, nonce: chunkNonce, size: dataToStore.length });
    } catch (err: any) {
      lastError = err;
      if (err?.code === 429 && attempt < RETRY_DELAYS.length - 1) {
        // Telegram's own flood-control wait time, when it gives one, beats
        // a blind fixed guess — but never block this invocation past
        // MAX_RETRY_AFTER_MS even if Telegram asks for longer; fail fast
        // and let the client fall back to S3 instead of silently eating
        // whatever execution-time budget this route has left.
        const requestedMs = typeof err?.retryAfterSeconds === "number" ? err.retryAfterSeconds * 1000 : undefined;
        if (requestedMs !== undefined && requestedMs > MAX_RETRY_AFTER_MS) {
          console.warn(`[POST /api/files/telegram/chunk] file ${fileId} chunk ${chunkIndex}: Telegram asked for a ${err.retryAfterSeconds}s retry_after, exceeding the ${MAX_RETRY_AFTER_MS}ms cap — giving up early, signaling S3 fallback`);
          return NextResponse.json({ error: "Upload failed: rate-limited", chunkIndex, canFallbackToS3: true }, { status: 503 });
        }
        const delay = requestedMs ?? RETRY_DELAYS[attempt];
        console.warn(`[POST /api/files/telegram/chunk] rate-limited on file ${fileId} chunk ${chunkIndex}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}, retry_after=${err?.retryAfterSeconds ?? "n/a"})`);
        await sleep(delay);
        continue;
      }
      console.error(`[POST /api/files/telegram/chunk] permanently failed file ${fileId} chunk ${chunkIndex} after ${attempt + 1} attempt(s), ${Date.now() - tStart}ms elapsed; signaling S3 fallback`, err);
      return NextResponse.json({ error: `Upload failed: ${err?.message || "Unknown"}`, chunkIndex, canFallbackToS3: true }, { status: 503 });
    }
  }

  await File.findByIdAndUpdate(fileId, { $set: { status: "paused", lastError: `Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries: ${lastError?.message || "Unknown"}` } });
  return NextResponse.json({ error: `Chunk ${chunkIndex} failed`, canFallbackToS3: true }, { status: 503 });
}