import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongoose";
import { getCacheControlHeader } from "@/lib/cdn";
import Folder from "@/models/Folder";

// GET /api/folders — list all folders for user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const folders = await Folder.find({ owner_email: session.user.email }).sort({ createdAt: -1 }).lean();
  
  const response = NextResponse.json(folders);
  response.headers.set('Cache-Control', getCacheControlHeader('folders'));
  
  return response;
}

// POST /api/folders — create a new folder
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await connectDB();
    const { name, parent_id } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: "Folder name required" }, { status: 400 });

    const folder = await Folder.create({
      name: name.trim(),
      owner_id:    session.user.id,
      owner_email: session.user.email,
      parent_id:   parent_id || null,
    });

    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}