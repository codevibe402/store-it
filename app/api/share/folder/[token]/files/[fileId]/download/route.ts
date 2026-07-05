import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import FolderShare from "@/adapters/database/models/Foldershare";
import { createS3DownloadUrl, createTelegramDownloadStream } from "@/server/lib/download";

type RouteContext = {
  params: Promise<{ token: string; fileId: string }>;
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { token, fileId } = await params;
  await connectDB();

  const share = await FolderShare.findOne({
    token,
    expiresAt: { $gt: new Date() },
    revokedAt: null,
  }).lean();

  if (!share) {
    return NextResponse.json({ error: "Share link not found or expired" }, { status: 404 });
  }

  const file = await File.findOne({
    _id: fileId,
    folderId: share.folderId,
    owner_id: share.owner_id,
    status: "uploaded",
  }).lean();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (share.maxDownloads && share.downloadCount >= share.maxDownloads) {
    return NextResponse.json({ error: "Download limit reached" }, { status: 403 });
  }

  await FolderShare.updateOne({ token }, { $inc: { downloadCount: 1 } });

  const versionId = req.nextUrl.searchParams.get("versionId");
  let version;

  if (versionId) {
    version = await FileVersion.findById(versionId).lean();
  } else if (file.currentVersionId) {
    version = await FileVersion.findById(file.currentVersionId).lean();
  }

  if (!version) {
    if (file.backend === "telegram") {
      return NextResponse.json({ error: "Version not found for Telegram download" }, { status: 404 });
    }
    const url = await createS3DownloadUrl(file.storageUrl, file.filename, file.mimetype);
    return NextResponse.redirect(url, 302);
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
