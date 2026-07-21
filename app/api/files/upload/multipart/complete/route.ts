import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import File from "@/adapters/database/models/File";
import { findConflictingUploadedFile, mergeAsNewVersion, createInitialVersion } from "@/server/services/versioningService";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key, uploadId, parts, fileId } = body as {
    key: string;
    uploadId: string;
    parts: { PartNumber: number; ETag: string }[];
    fileId: string;
  };

  if (!key || !uploadId || !Array.isArray(parts) || !fileId) {
    return NextResponse.json(
      { error: "key, uploadId, parts, and fileId are required" },
      { status: 400 }
    );
  }

  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
        },
      })
    );
  } catch (err) {
    console.error(`[POST /api/files/upload/multipart/complete] S3 CompleteMultipartUpload failed for key ${key} (${parts.length} part(s))`, err);
    return NextResponse.json({ error: "Failed to finalize upload in storage" }, { status: 500 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    console.warn(`[POST /api/files/upload/multipart/complete] file ${fileId} not found after S3 completed (key ${key})`);
    return NextResponse.json({ error: "File record not found" }, { status: 404 });
  }
  if (file.owner_email !== user.email) {
    console.warn(`[POST /api/files/upload/multipart/complete] forbidden: ${user.email} does not own file ${fileId}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (file.status !== "uploaded") {
    const content = { backend: "s3" as const, storageUrl: key, hash: file.hash, size: file.size, mimetype: file.mimetype };
    const extraFileFields = { searchText: file.searchText };

    const session = await mongoose.startSession();
    try {
      let result: { file: InstanceType<typeof File>; version: number; versioned: boolean } | undefined;

      await session.withTransaction(async () => {
        const existingByName = file.status === "pending"
          ? await findConflictingUploadedFile({
              session,
              filename: file.filename,
              ownerId: file.owner_id,
              folderId: file.folderId,
              hash: file.hash,
              excludeFileId: file._id,
            })
          : null;

        result = existingByName
          ? await mergeAsNewVersion({ session, existingFile: existingByName, content, createdBy: file.owner_id, extraFileFields, placeholderFileId: file._id })
          : await createInitialVersion({ session, file, content, createdBy: file.owner_id, extraFileFields });
      });

      return NextResponse.json(
        result!.versioned ? { file: result!.file, version: result!.version, versioned: true } : { file: result!.file },
        { status: 200 }
      );
    } finally {
      await session.endSession();
    }
  }

  return NextResponse.json({ file }, { status: 200 });
}
