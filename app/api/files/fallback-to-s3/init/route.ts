import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import File from "@/adapters/database/models/File";
import User from "@/adapters/database/models/User";

const CHUNK_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { fileId, filename, mimeType, size, hash } = body as {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
    hash: string;
  };

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  await connectDB();

  const user = await User.findOne({ email: authUser.email });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.owner_email !== user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.hasEnoughStorage(size)) {
    return NextResponse.json({ error: "Storage limit exceeded" }, { status: 413 });
  }

  const existingUpload = await File.findOne({
    hash,
    owner_id: user._id,
    status: "uploaded",
  });
  if (existingUpload) {
    return NextResponse.json(
      { error: "Duplicate file", existingFile: existingUpload },
      { status: 409 },
    );
  }

  const key = file.storageUrl || `uploads/${user._id}/${Date.now()}-${filename}`;

  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mimeType,
    })
  );

  if (!UploadId) {
    return NextResponse.json({ error: "Failed to initiate S3 multipart upload" }, { status: 500 });
  }

  file.uploadId = UploadId;
  file.destination = key;
  file.status = "s3_pending";
  if (!file.storageUrl) {
    file.storageUrl = key;
  }
  await file.save();

  const totalParts = Math.ceil(size / CHUNK_SIZE);

  return NextResponse.json({
    uploadId: UploadId,
    key,
    totalParts,
    fileId: file._id.toString(),
    totalChunks: file.totalChunks,
    chunkSize: file.chunkSize,
  });
}