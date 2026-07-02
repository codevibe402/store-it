import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import { s3, BUCKET } from "@/lib/s3";
import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import File from "@/models/File";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId, uploadId, key } = await req.json();
  if (!fileId || !uploadId || !key) {
    return NextResponse.json({ error: "fileId, uploadId, and key are required" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
      }),
    );
  } catch {
  }

  await File.findByIdAndDelete(fileId);

  return NextResponse.json({ message: "Upload cancelled and cleaned up" });
}
