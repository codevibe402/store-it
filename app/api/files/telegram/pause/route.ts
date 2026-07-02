import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await req.json();
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (file.backend !== "telegram") {
    return NextResponse.json({ error: "Only Telegram uploads can be paused" }, { status: 400 });
  }
  if (!["pending", "uploading"].includes(file.status)) {
    return NextResponse.json({ error: `Cannot pause file in status "${file.status}"` }, { status: 409 });
  }

  file.status = "paused";
  await file.save();

  return NextResponse.json({ message: "Upload paused" });
}
