import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { ServiceError } from "@/server/services/shareService";
import connectDB from "@/adapters/database/mongoose";
import Folder from "@/adapters/database/models/Folder";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    await connectDB();

    const folder = await Folder.findOne({ _id: id, owner_id: user.userId }).lean();
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

    return NextResponse.json({ folder });
  } catch (err) {
    console.error("[GET /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}