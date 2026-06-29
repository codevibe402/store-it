import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import { getCacheControlHeader } from "@/lib/cdn";
import File from "@/models/File";
import { NextRequest, NextResponse } from "next/server";


export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();

    const status = req.nextUrl.searchParams.get("status") || "uploaded";

    const files = await File.find({
      owner_email: session.user.email,
      status,
    })
      .sort({ createdAt: -1 })
      .lean();

    // ── NEW: return grouped structure if ?grouped=true ──────────────
    

    const normalizedFiles = files.map((file) => ({
      ...file,
      folderId: file.folderId?.toString?.() ?? file.folders_id?.toString?.() ?? null,
    }));

    // ── Add cache headers for 5 minutes ──────────────────────────────
    const response = NextResponse.json(normalizedFiles);
    response.headers.set('Cache-Control', getCacheControlHeader('metadata'));
    
    return response;

  } catch (error) {
    console.error("Failed to fetch files:", error);
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 }
    );
  }
}
