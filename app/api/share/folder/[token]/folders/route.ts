import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongoose";
import Folder from "@/models/Folder";
import FolderShare from "@/models/Foldershare";
import User from "@/models/User";

type RouteContext = {
  params: Promise<{ token: string }>;
};

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
