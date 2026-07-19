import { ObjectId } from "mongodb";
import { getAuthUser } from "@/server/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import connectDB from "@/adapters/database/mongoose";
import { BUCKET, s3 } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  const user = await getAuthUser();
  if (!user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findOne({
    _id: id,
    owner_id: user.userId,
    status: "uploaded",
    deleted: { $ne: true },
  }).lean();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const versions = await FileVersion.find({ file_id: id }).sort({ version: -1 }).lean();

  return NextResponse.json({
    file: {
      _id: file._id.toString(),
      filename: file.filename,
      currentVersionId: file.currentVersionId?.toString(),
      currentVersion: versions[0]?.version ?? 1,
    },
    versions: versions.map((version) => ({
      id: version._id.toString(),
      version: version.version,
      uploadedAt: version.uploadedAt,
      backend: version.backend,
      storageUrl: version.storageUrl,
      hash: version.hash,
      size: version.size,
      mimetype: version.mimetype,
      isCurrent: file.currentVersionId?.toString() === version._id.toString(),
    })),
  });
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const user = await getAuthUser();
  if (!user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { storageUrl } = (await req.json()) as { storageUrl?: string };

  if (!ObjectId.isValid(id) || !storageUrl) {
    return NextResponse.json({ error: "file id and storageUrl are required" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findOne({ _id: id, owner_id: user.userId, status: "uploaded", deleted: { $ne: true } }).lean();
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const version = await FileVersion.findOne({ file_id: id, storage_url: storageUrl }).lean();
  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  // For Telegram versions, return a download URL
  if (version.backend === "telegram") {
    return NextResponse.json({
      downloadUrl: `/api/files/${id}/download?versionId=${version._id}`,
    });
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: storageUrl,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.filename)}"`,
      ResponseContentType: file.mimetype,
    }),
    { expiresIn: 60 * 10 }
  );

  return NextResponse.json({ url });
}
