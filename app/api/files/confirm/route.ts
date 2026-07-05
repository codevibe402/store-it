import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import User from "@/adapters/database/models/User";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { fileId } = body as { fileId: string };

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Prevent double-counting if confirm is called more than once
  if (file.status === "uploaded") {
    return NextResponse.json({ file }, { status: 200 });
  }

  file.status = "uploaded";
  await file.save();

  // Increment user's storage usage
  await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size } });

  return NextResponse.json({ file }, { status: 200 });
}