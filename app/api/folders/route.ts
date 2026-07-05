import { getAuthUser } from "@/server/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/adapters/database/mongoose";
import Folder from "@/adapters/database/models/Folder";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();

  const folders = await Folder.find({ owner_email: user.email })
    .select("name owner_id parent_id createdAt _id")
    .sort({ createdAt: -1 })
    .lean();

  const response = NextResponse.json(folders);
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");

  return response;
}

// POST /api/folders — create a new folder
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { name, parent_id } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: "Folder name required" }, { status: 400 });

    const folder = await Folder.create({
      name: name.trim(),
      owner_id:    user.userId,
      owner_email: user.email,
      parent_id:   parent_id || null,
    });

    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}