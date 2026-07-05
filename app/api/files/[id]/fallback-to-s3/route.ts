import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
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
    return NextResponse.json(
      { error: "File not found or not in a fallback-eligible state" },
      { status: 409 },
    );
  }

  const chunks = await TelegramChunk.find({ fileId: id });
  const cleanupWarnings: string[] = [];

  for (const chunk of chunks) {
    try {
      await deleteMessage(chunk.telegramMessageId);
    } catch {
      cleanupWarnings.push(`Failed to delete Telegram message ${chunk.telegramMessageId}`);
    }
  }

  await TelegramChunk.deleteMany({ fileId: id }).catch(() => {
    cleanupWarnings.push("Failed to delete TelegramChunk records");
  });

  const key = `uploads/${file.owner_id}/${Date.now()}-${file.filename}`;

  await File.findByIdAndUpdate(id, {
    $set: {
      backend: "s3",
      status: "s3_pending",
      storageUrl: key,
      destination: key,
      totalChunks: undefined,
      chunkSize: undefined,
      lastError: null,
      fallbackCompletedAt: new Date(),
    },
    $push: cleanupWarnings.length > 0 ? { cleanupWarnings: { $each: cleanupWarnings } } : undefined,
  });

  return NextResponse.json({
    fileId: id,
    backend: "s3",
    status: "s3_pending",
    key,
    cleanupWarnings: cleanupWarnings.length > 0 ? cleanupWarnings : undefined,
  });
}
