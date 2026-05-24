import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import { generateFileUrl, CDN_CONFIG } from "@/lib/cdn";
import File from "@/models/File";
import User from "@/models/User";

// ── POST /api/files/fetch/url ─────────────────────────────────────────────────
// Returns a CloudFront URL for authenticated users to fetch their files.
// CloudFront caches the files for 24 hours (see CDN_CONFIG.cacheTTL.files).
// 
// Strategy:
// - Regular downloads use CloudFront URLs (cached 24hrs)
// - Shares/versions use presigned URLs from other endpoints
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key } = body as { key: string };

  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  await connectDB();

  // Ownership check — users can only get URLs to their own files
  const user = await User.findOne({ email: session.user.email });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const file = await File.findOne({ storageUrl: key, owner_id: user._id });
  if (!file) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // ── Generate CloudFront URL (cached) ───────────────────────────────────────
  const url = generateFileUrl(key);

  return NextResponse.json({ url, cached: true }, { status: 200 });
}