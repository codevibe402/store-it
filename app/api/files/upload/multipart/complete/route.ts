import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import { s3, BUCKET } from "@/lib/s3";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import File from "@/models/File";
import FileVersion from "@/models/FileVersion";
import User from "@/models/User";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
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

  // Tell S3 to assemble the parts
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

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File record not found" }, { status: 404 });
  }

  // Prevent double-counting if complete is called more than once
  if (file.status !== "uploaded") {
    file.status = "uploaded";
    await file.save();

    await FileVersion.updateOne(
      { file_id: file._id, version: 1 },
      { $setOnInsert: { file_id: file._id, version: 1, storage_url: file.storageUrl } },
      { upsert: true }
    );

    await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size } });
  }

  return NextResponse.json({ file }, { status: 200 });
}
