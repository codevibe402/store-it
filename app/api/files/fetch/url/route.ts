import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { generateFileUrl, CDN_CONFIG } from "@/adapters/storage/cdn";
import File from "@/adapters/database/models/File";
import User from "@/adapters/database/models/User";

// ── POST /api/files/fetch/url ─────────────────────────────────────────────────
// Returns a CloudFront URL for authenticated users to fetch their files.
// CloudFront caches the files for 24 hours (see CDN_CONFIG.cacheTTL.files).
// 
// Strategy:
// - Regular downloads use CloudFront URLs (cached 24hrs)
// - Shares/versions use presigned URLs from other endpoints
export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key } = body as { key: string };

  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  await connectDB();

  // Ownership check — users can only get URLs to their own files
  const user = await User.findOne({ email: authUser.email });
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