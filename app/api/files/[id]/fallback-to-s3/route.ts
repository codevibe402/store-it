import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import { deleteMessage } from "@/adapters/storage/telegram";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { reason } = await req.json().catch(() => ({}));

  await connectDB();

  const user = await (await import("@/adapters/database/models/User")).default.findOne({ email: authUser.email });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const file = await File.findOneAndUpdate(
    {
      _id: id,
      owner_id: user._id,
      backend: "telegram",
      status: { $in: ["pending", "uploading", "paused", "fallback_cleanup"] },
    },
    {
      $set: {
        status: "fallback_cleanup",
        fallbackFrom: "telegram",
        fallbackReason: reason ?? "telegram_failed_after_retries",
        fallbackStartedAt: new Date(),
      },
    },
    { new: true },
  );

  if (!file) {
    console.warn(`[POST /api/files/${id}/fallback-to-s3] rejected: file not found or not in a fallback-eligible state (reason=${reason ?? "unspecified"})`);
    return NextResponse.json(
      { error: "File not found or not in a fallback-eligible state" },
      { status: 409 },
    );
  }

  console.info(`[POST /api/files/${id}/fallback-to-s3] switching backend telegram->s3 (reason=${reason ?? "unspecified"})`);

  const existingUpload = await File.findOne({
    hash: file.hash,
    owner_id: user._id,
    status: "uploaded",
    deleted: { $ne: true },
  });
  if (existingUpload) {
    console.warn(`[POST /api/files/${id}/fallback-to-s3] aborted: duplicate of already-uploaded file ${existingUpload._id}`);
    return NextResponse.json(
      { error: "Duplicate file", existingFile: existingUpload },
      { status: 409 },
    );
  }

  const chunks = await TelegramChunk.find({ fileId: id });
  const cleanupWarnings: string[] = [];

  for (const chunk of chunks) {
    try {
      await deleteMessage(chunk.telegramMessageId);
    } catch (err) {
      console.error(`[POST /api/files/${id}/fallback-to-s3] failed to delete Telegram message ${chunk.telegramMessageId}`, err);
      cleanupWarnings.push(`Failed to delete Telegram message ${chunk.telegramMessageId}`);
    }
  }

  await TelegramChunk.deleteMany({ fileId: id }).catch((err) => {
    console.error(`[POST /api/files/${id}/fallback-to-s3] failed to delete TelegramChunk records`, err);
    cleanupWarnings.push("Failed to delete TelegramChunk records");
  });
  await EncryptionKey.deleteOne({ fileId: id }).catch((err) => {
    console.error(`[POST /api/files/${id}/fallback-to-s3] failed to delete EncryptionKey record`, err);
  });

  const key = `uploads/${file.owner_id}/${Date.now()}-${file.filename}`;

  await File.findByIdAndUpdate(id, {
    $set: {
      backend: "s3",
      status: "s3_pending",
      storageUrl: key,
      destination: key,
      lastError: null,
      fallbackCompletedAt: new Date(),
      // The S3 upload path never had a decrypt mechanism (no manifest/
      // chunk-data routes exist for backend:"s3" — those are Telegram-only).
      // Whatever encryption mode the Telegram attempt was using no longer
      // applies once bytes land in S3 as plaintext, so this is reset
      // explicitly rather than left stale and misleading.
      encryptionMode: "none",
      encryptionKey: null,
      encryptionIv: null,
    },
    // totalChunks/chunkSize are Telegram-only fields; they're unset (not
    // $set to undefined — Mongoose silently drops undefined keys from a
    // $set document, so the previous version of this code never actually
    // cleared them and left stale Telegram chunk metadata on an S3 file).
    $unset: { totalChunks: "", chunkSize: "" },
    // Unlike a nested key inside $set, Mongoose does NOT silently drop a
    // top-level update operator whose value is undefined — `$push:
    // undefined` throws "Invalid atomic update value for $push. Expected an
    // object, received undefined" and crashes every fallback request that
    // has no cleanup warnings to report (i.e. the common case). The key
    // must be omitted entirely, not set to undefined.
    ...(cleanupWarnings.length > 0 ? { $push: { cleanupWarnings: { $each: cleanupWarnings } } } : {}),
  });

  if (cleanupWarnings.length > 0) {
    console.warn(`[POST /api/files/${id}/fallback-to-s3] completed with cleanup warnings`, cleanupWarnings);
  }

  return NextResponse.json({
    fileId: id,
    backend: "s3",
    status: "s3_pending",
    key,
    cleanupWarnings: cleanupWarnings.length > 0 ? cleanupWarnings : undefined,
  });
}
