import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import User from "@/adapters/database/models/User";

const CHUNK_SIZE = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename, mimeType, size, hash, folderId } = await req.json();
  if (!filename || !size || !hash) {
    return NextResponse.json({ error: "filename, size, and hash are required" }, { status: 400 });
  }

  await connectDB();

  const user = await User.findOne({ email: authUser.email });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!user.hasEnoughStorage(size)) {
    return NextResponse.json({ error: "Storage limit exceeded" }, { status: 413 });
  }

  const existing = await File.findOne({ owner_id: user._id, hash, backend: "telegram" });
  if (existing) {
    if (existing.status === "uploaded") {
      return NextResponse.json({ error: "Duplicate file", existingFile: existing }, { status: 409 });
    }
    return NextResponse.json({
      fileId: existing._id.toString(),
      totalChunks: existing.totalChunks,
      chunkSize: existing.chunkSize,
      resuming: true,
    });
  }

  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const key = `telegram/${user._id}/${Date.now()}-${filename}`;

  const file = await File.create({
    filename,
    hash,
    size,
    mimetype: mimeType || "application/octet-stream",
    owner_id: user._id,
    owner_email: user.email,
    storageUrl: key,
    folderId: folderId ?? null,
    folders_id: folderId ?? null,
    backend: "telegram",
    totalChunks,
    chunkSize: CHUNK_SIZE,
    status: "pending",
  });

  return NextResponse.json({
    fileId: file._id.toString(),
    totalChunks,
    chunkSize: CHUNK_SIZE,
  });
}
