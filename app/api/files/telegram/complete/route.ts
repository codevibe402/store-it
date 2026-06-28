import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import TelegramChunk from "@/models/TelegramChunk";
import User from "@/models/User";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await req.json();
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const chunkCount = await TelegramChunk.countDocuments({ fileId });
  if (chunkCount !== file.totalChunks) {
    return NextResponse.json(
      { error: `Only ${chunkCount}/${file.totalChunks} chunks uploaded` },
      { status: 400 },
    );
  }

  if (file.status !== "uploaded") {
    file.status = "uploaded";
    await file.save();
    await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size } });
  }

  return NextResponse.json({ file });
}
