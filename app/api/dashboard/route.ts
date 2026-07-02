import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import Folder from "@/models/Folder";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await connectDB();

    const [files, folders, pendingFiles] = await Promise.all([
      File.find({ owner_email: session.user.email, status: "uploaded" })
        .select("_id filename mimetype size folderId folders_id backend status createdAt updatedAt owner_id hash")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),

      Folder.find({ owner_email: session.user.email })
        .select("name owner_id parent_id createdAt _id")
        .sort({ createdAt: -1 })
        .lean(),

      File.find({
        owner_email: session.user.email,
        status: { $in: ["pending", "uploading", "paused", "fallback_cleanup", "s3_pending"] },
      })
        .select("_id filename mimetype size folderId folders_id backend status createdAt updatedAt owner_id hash")
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const normalizeFile = (f: Record<string, any>) => ({
      ...f,
      folderId: f.folderId?.toString?.() ?? f.folders_id?.toString?.() ?? null,
    });

    const response = NextResponse.json({
      files: files.map(normalizeFile),
      folders,
      pendingFiles: pendingFiles.map(normalizeFile),
    });
    response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");

    return response;
  } catch (error) {
    console.error("Dashboard fetch failed:", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
