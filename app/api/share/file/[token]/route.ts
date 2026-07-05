import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import FileShare from "@/adapters/database/models/Fileshare";
import { createS3DownloadUrl, createTelegramDownloadStream } from "@/server/lib/download";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { token } = await params;
  await connectDB();

  const share = await FileShare.findOne({
    shareToken: token,
    expiresAt:  { $gt: new Date() },
  }).lean();

  if (!share) {
    return NextResponse.json({ error: "Share link not found or expired" }, { status: 404 });
  }

  if (share.backend === "s3") {
    return NextResponse.redirect(share.shareUrl, 302);
  }

  const file = await File.findOne({
    _id:    share.fileId,
    status: "uploaded",
  }).lean();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const versionId = req.nextUrl.searchParams.get("versionId");
  let version;

  if (versionId) {
    version = await FileVersion.findById(versionId).lean();
  } else if (file.currentVersionId) {
    version = await FileVersion.findById(file.currentVersionId).lean();
  }

  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  if (version.backend === "telegram") {
    return createTelegramDownloadStream(
      version._id.toString(),
      version.size,
      version.mimetype,
      file.filename,
    );
  }

  const url = await createS3DownloadUrl(
    version.storageUrl,
    file.filename,
    version.mimetype,
  );
  return NextResponse.redirect(url, 302);
}
