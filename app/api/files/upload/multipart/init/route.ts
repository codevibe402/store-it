import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import File from "@/adapters/database/models/File";
import User from "@/adapters/database/models/User";

const CHUNK_SIZE = 10 * 1024 * 1024; // must match frontend

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { filename, mimeType, size, folderId = null, hash, fileId } = body as {
    filename: string;
    mimeType: string;
    size: number;
    folderId: string | null;
    hash: string;
    fileId?: string;
  };

  if (!filename || !mimeType || !size || !hash) {
    return NextResponse.json(
      { error: "filename, mimeType, size, and hash are required" },
      { status: 400 }
    );
  }

  await connectDB();

  const user = await User.findOne({ email: authUser.email });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let existingFileRecord = null;

  if (fileId) {
    existingFileRecord = await File.findOne({
      _id: fileId,
      owner_id: user._id,
      status: "s3_pending",
      backend: "s3",
    });
    if (!existingFileRecord) {
      return NextResponse.json(
        { error: "Fallback file not found or not in s3_pending state" },
        { status: 404 },
      );
    }
    if (existingFileRecord.hash !== hash) {
      return NextResponse.json(
        { error: "Selected file does not match the original. Hash mismatch." },
        { status: 409 },
      );
    }
  } else {
    if (!user.hasEnoughStorage(size)) {
      return NextResponse.json({ error: "Storage limit exceeded" }, { status: 413 });
    }

    existingFileRecord = await File.findOne({ hash, owner_id: user._id, status: "uploaded" });
    if (existingFileRecord) {
      return NextResponse.json(
        { error: "Duplicate file", existingFile: existingFileRecord },
        { status: 409 }
      );
    }
  }

  const key = existingFileRecord
    ? existingFileRecord.storageUrl
    : `uploads/${user._id}/${Date.now()}-${filename}`;

  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mimeType,
    })
  );

  if (!UploadId) {
    return NextResponse.json(
      { error: "Failed to initiate multipart upload" },
      { status: 500 }
    );
  }

  let file;
  if (existingFileRecord) {
    file = existingFileRecord;
    file.uploadId = UploadId;
    file.destination = key;
    await file.save();
  } else {
    file = await File.create({
      filename,
      hash,
      owner_email: user.email,
      owner_id: user._id,
      mimetype: mimeType,
      size,
      storageUrl: key,
      destination: key,
      uploadId: UploadId,
      folders_id: folderId ?? null,
      folderId: folderId ?? null,
      status: "pending",
    });
  }

  const totalParts = Math.ceil(size / CHUNK_SIZE);

  return NextResponse.json(
    { uploadId: UploadId, key, totalParts, fileId: file._id.toString() },
    { status: 200 }
  );
}
