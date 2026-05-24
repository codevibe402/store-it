import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import { getCacheControlHeader } from "@/lib/cdn";
import File from "@/models/File";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  await connectDB();

  const regex = new RegExp(escapeRegex(q), "i");
  const files = await File.find({
    owner_id: session.user.id,
    status: "uploaded",
    $or: [{ filename: regex }, { searchText: regex }, { mimetype: regex }],
  })
    .sort({ updatedAt: -1 })
    .limit(12)
    .lean();

  const response = NextResponse.json({
    results: files.map((file) => ({
      _id: file._id.toString(),
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      storageUrl: file.storageUrl,
      folderId: file.folderId?.toString?.() ?? file.folders_id?.toString?.() ?? null,
      createdAt: file.createdAt,
      matchedContent: Boolean(file.searchText && regex.test(file.searchText)),
      snippet: buildSnippet(file.searchText ?? "", q),
    })),
  });
  
  response.headers.set('Cache-Control', getCacheControlHeader('search'));
  return response;
}

function buildSnippet(text: string, query: string) {
  if (!text) return "";
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, 140);
  const start = Math.max(0, index - 60);
  return `${start > 0 ? "..." : ""}${text.slice(start, index + query.length + 90)}`;
}
