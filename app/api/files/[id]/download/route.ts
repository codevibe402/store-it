// app/api/files/[id]/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSession } from "next-auth";
import connectMongoose from "@/lib/mongoose";
import { authOptions } from "@/lib/[...nextauth]";          // ← fixed path
import { s3, BUCKET } from "@/lib/s3";
import { generateFileUrl, CDN_CONFIG } from "@/lib/cdn";
import File from "@/models/File";

const DOWNLOAD_URL_TTL = 60; // seconds — short-lived, browser fetches immediately

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return session.user.id;
}

// ── GET /api/files/:id/download ───────────────────────────────────────────────
// Returns a 302 redirect to download the file.
//
// Strategy:
// - If CloudFront is configured: Uses CloudFront URL (cached 24 hours) ✅
// - If CloudFront is NOT configured: Falls back to S3 presigned URL
//
// This endpoint is for authenticated user downloads of their own files.
// For shared files, see POST /api/files/:id/share (uses presigned URLs)
// For version downloads, see POST /api/files/:id/versions (uses presigned URLs)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();   // ← was broken `await (req)` call
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    }

    await connectMongoose();

    // ── 1. Fetch file record ───────────────────────────────────────────────
    const file = await File.findOne({   // ← replaced db.collection("files")
      _id:      id,
      owner_id: userId,
      status:   "uploaded",
    }).lean();

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // ── 2. Generate download URL ────────────────────────────────────────────
    let downloadUrl: string;

    if (CDN_CONFIG.useCloudFront) {
      // Use CloudFront URL directly (pre-signed at CDN level)
      downloadUrl = generateFileUrl(file.storageUrl);
    } else {
      // Fall back to S3 presigned URL
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key:    file.storageUrl,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(file.filename)}"`,
        ResponseContentType: file.mimetype,
      });

      downloadUrl = await getSignedUrl(s3, command, {
        expiresIn: 60, // 60 seconds
      });
    }

    // ── 3. Redirect — browser follows immediately and starts the download ──
    const response = NextResponse.redirect(downloadUrl, { status: 302 });
    
    // Add cache headers for CDN
    if (CDN_CONFIG.useCloudFront) {
      response.headers.set('Cache-Control', 'public, max-age=86400');
    }
    
    return response;
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[GET /api/files/:id/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

