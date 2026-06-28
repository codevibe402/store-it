import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import TelegramChunk from "@/models/TelegramChunk";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  });
}
