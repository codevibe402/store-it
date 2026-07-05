import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/adapters/database/mongoose";
import Folder from "@/adapters/database/models/Folder";
import File from "@/adapters/database/models/File";
import FolderShare from "@/adapters/database/models/Foldershare";
import User from "@/adapters/database/models/User";

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { token } = await params;
  await connectDB();

  const share = await FolderShare.findOne({
    token,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!share) {
    return NextResponse.json({ error: "Share link not found or expired" }, { status: 404 });
  }

  const files = await File.find({
    folderId: share.folderId,
    owner_id: share.owner_id,
    status: "uploaded",
  })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    folderName: share.folderName,
    permission: share.permission,
    expiresAt: share.expiresAt,
    allowVersionHistory: share.allowVersionHistory,
    files: files.map((f) => ({
      fileId: f._id.toString(),
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
      backend: f.backend,
      downloadUrl: `/api/share/folder/${token}/files/${f._id}/download`,
    })),
  });
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { token } = await params;
  const { name } = (await req.json()) as { name?: string };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Folder name required" }, { status: 400 });
  }

  await connectDB();

  const share = await FolderShare.findOne({
    token,
    permission: "add",
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!share) {
    return NextResponse.json({ error: "This share link cannot add folders" }, { status: 403 });
  }

  const owner = await User.findById(share.owner_id).lean();

  const folder = await Folder.create({
    name: name.trim(),
    owner_id: share.owner_id,
    owner_email: owner?.email ?? "",
    parent_id: share.folderId,
  });

  return NextResponse.json({ folder }, { status: 201 });
}
