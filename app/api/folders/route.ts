import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import Folder from "@/adapters/database/models/Folder";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const parent_id = searchParams.get("parent_id");

    await connectDB();

    const folders = await Folder.find({ owner_id: user.userId, parent_id: parent_id || null }).lean();
    return NextResponse.json({ folders });
  } catch (err) {
    console.error("[GET /api/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body || !body.name?.trim()) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });

    await connectDB();

    const folder = await Folder.create({
      name: body.name.trim(),
      owner_id: user.userId,
      owner_email: user.email,
      parent_id: body.parent_id || null,
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/folders]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}