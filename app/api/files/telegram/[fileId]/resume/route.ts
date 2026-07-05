import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.backend !== "telegram") {
    return NextResponse.json({
      fileId,
      backend: file.backend,
      status: file.status,
      canResumeTelegram: false,
      canFallbackToS3: file.status === "s3_pending",
    });
  }

  const chunks = await TelegramChunk.find({ fileId }).sort({ chunkIndex: 1 }).lean();
  const uploadedIndexes = chunks.map((c) => c.chunkIndex);
  const uploadedBytes = chunks.reduce((sum, c) => sum + c.size, 0);

  return NextResponse.json({
    fileId,
    backend: file.backend,
    status: file.status,
    totalChunks: file.totalChunks,
    chunkSize: file.chunkSize,
    uploadedIndexes,
    uploadedBytes,
    totalBytes: file.size,
    canResumeTelegram: ["pending", "uploading", "paused"].includes(file.status),
    canFallbackToS3: file.status === "paused",
  });
}
