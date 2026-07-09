import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import User from "@/adapters/database/models/User";
import { deleteMessage } from "@/adapters/storage/telegram";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { fileId, encryptionIv, encryptionKey } = body as {
    fileId: string;
    encryptionIv?: string;
    encryptionKey?: string;
  };

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.owner_email !== user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.backend !== "telegram") {
    return NextResponse.json({ error: "File is not stored in Telegram" }, { status: 409 });
  }

  const chunkCount = await TelegramChunk.countDocuments({ fileId });
  if (chunkCount !== file.totalChunks) {
    return NextResponse.json(
      { error: `Only ${chunkCount}/${file.totalChunks} chunks uploaded` },
      { status: 400 },
    );
  }

  if (file.status === "uploaded") {
    return NextResponse.json({ file, alreadyUploaded: true });
  }

  file.status = "uploaded";
  await file.save();

  const userDoc = await User.findById(file.owner_id);
  if (userDoc) {
    userDoc.storageused = (userDoc.storageused || 0) + file.size;
    await userDoc.save();
  }

  const version = await FileVersion.create({
    file_id: file._id,
    version: 1,
    backend: "telegram",
    storageUrl: file.storageUrl,
    hash: file.hash,
    size: file.size,
    mimetype: file.mimetype,
    createdBy: file.owner_id,
  });

  file.currentVersionId = version._id;
  await file.save();

  await TelegramChunk.updateMany(
    { fileId: file._id },
    { $set: { versionId: version._id } },
  );

  return NextResponse.json({ file, versionId: version._id.toString() });
}