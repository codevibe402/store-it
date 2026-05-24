// app/api/files/[id]/share/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSession } from "next-auth";
import connectDB from "@/lib/mongoose";
import { authOptions } from "@/lib/[...nextauth]";
import { s3, BUCKET } from "@/lib/s3";
import File from "@/models/File";
import FileShare from "@/models/Fileshare";

// Share links are valid for 7 days. Re-calling POST within this window returns
// the same link rather than minting a new one — preventing link sprawl.
const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHARE_TTL_MS      = SHARE_TTL_SECONDS * 1000;

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

// ── POST /api/files/:id/share ─────────────────────────────────────────────────
// Creates a presigned S3 URL that anyone can use to view/download the file.
// Idempotent — returns the existing share if still valid (> 30 min remaining).
//
// Strategy:
// - Uses S3 presigned URLs with 7-day expiration
// - CloudFront automatically caches the presigned URL for its lifetime
// - When the presigned URL expires, CloudFront stops serving it
// - No extra setup needed—expiration is built into the presigned URL
//
// Note: This endpoint is for shared access (anyone with the URL can access).
// For regular user downloads, see GET /api/files/:id/download (CloudFront cached)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    const { id } = await params;

    

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    }

    await connectDB();
    const now = new Date();

    // ── 1. Verify file ownership ───────────────────────────────────────────
    const file = await File.findOne({
      _id:      id,
      owner_id: userId,
      status:   "uploaded",
    }).lean();

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // ── 2. Return existing share if still valid (> 30 min remaining) ───────
    const minRemaining = new Date(now.getTime() + 30 * 60 * 1000);

    const existingShare = await FileShare.findOne({
      fileId:    id,
      owner_id:  userId,
      expiresAt: { $gt: minRemaining },
    }).lean();

    if (existingShare) {
      return NextResponse.json({
        shareUrl:  existingShare.shareUrl,
        expiresAt: existingShare.expiresAt,
        reused:    true,
      });
    }

    // ── 3. Mint a fresh presigned URL ──────────────────────────────────────
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key:    file.storageUrl,
      // Inline so the link opens in the browser rather than forcing download
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.filename)}"`,
      ResponseContentType: file.mimetype,
    });

    const shareUrl = await getSignedUrl(s3, command, {   // ← was s3Client
      expiresIn: SHARE_TTL_SECONDS,
    });

    const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);

    // ── 4. Persist the share record ────────────────────────────────────────
    // TTL index lives on the FileShare schema — not recreated here each call
    await FileShare.create({
      fileId:   id,
      filename: file.filename,
      owner_id: userId,
      shareUrl,
      expiresAt,
    });

    return NextResponse.json({ shareUrl, expiresAt, reused: false });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[POST /api/files/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── DELETE /api/files/:id/share ───────────────────────────────────────────────
// Revokes all active share links for this file (removes them from the DB).
// Note: previously distributed S3 presigned URLs remain valid until their own
// TTL expires — shorten SHARE_TTL_SECONDS above if near-instant revocation matters.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    const { id } = await params;

    

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    }

    await connectDB();

    const result = await FileShare.deleteMany({
      fileId:   id,
      owner_id: userId,
    });

    return NextResponse.json({ success: true, revoked: result.deletedCount });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[DELETE /api/files/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

