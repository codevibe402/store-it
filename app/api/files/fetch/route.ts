import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();

    const statusParam = req.nextUrl.searchParams.get("status") || "uploaded";
    const statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 50, 1), 500) : undefined;

    let query = File.find({
      owner_email: session.user.email,
      status: statuses.length === 1 ? statuses[0] : { $in: statuses },
    })
      .select("_id filename mimetype size folderId folders_id backend status createdAt updatedAt owner_id hash")
      .sort({ createdAt: -1 });

    if (limit) query = query.limit(limit);

    const files = await query.lean();

    const normalizedFiles = files.map((file) => ({
      ...file,
      folderId: file.folderId?.toString?.() ?? file.folders_id?.toString?.() ?? null,
    }));

    const response = NextResponse.json(normalizedFiles);
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");

    return response;
  } catch (error) {
    console.error("Failed to fetch files:", error);
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 }
    );
  }
}
