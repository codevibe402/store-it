import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import {
  findConflictingUploadedFile,
  mergeAsNewVersion,
  createInitialVersion,
  wouldConflictServerEncryptionKey,
} from "@/server/services/versioningService";

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

  const content = { backend: "telegram" as const, storageUrl: file.storageUrl, hash: file.hash, size: file.size, mimetype: file.mimetype };
  // Propagated onto the winning File doc so it correctly reflects *this*
  // (the newly-finished) upload's encryption state, whether or not it ends
  // up merging into an existing file.
  const extraFileFields = { encryptionMode: file.encryptionMode, encryptionKey: file.encryptionKey, encryptionIv: file.encryptionIv };

  const session = await mongoose.startSession();
  try {
    let result: { file: InstanceType<typeof File>; version: number; versionId: string; versioned: boolean } | undefined;

    await session.withTransaction(async () => {
      const existingByName = await findConflictingUploadedFile({
        session,
        filename: file.filename,
        ownerId: file.owner_id,
        folderId: file.folderId,
        hash: file.hash,
        excludeFileId: file._id,
      });

      const canMerge = existingByName && !wouldConflictServerEncryptionKey(existingByName, file.encryptionKey);

      if (existingByName && canMerge) {
        result = await mergeAsNewVersion({
          session,
          existingFile: existingByName,
          content,
          createdBy: file.owner_id,
          extraFileFields,
          placeholderFileId: file._id,
        });
      } else {
        result = await createInitialVersion({ session, file, content, createdBy: file.owner_id, extraFileFields });
        await TelegramChunk.updateMany(
          { fileId: file._id },
          { $set: { versionId: result.versionId } }
        ).session(session);
      }
    });

    return NextResponse.json({ file: result!.file, versionId: result!.versionId, version: result!.version, versioned: result!.versioned });
  } finally {
    await session.endSession();
  }
}