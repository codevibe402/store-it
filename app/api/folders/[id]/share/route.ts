// app/api/folders/[id]/share/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerSession } from "next-auth";
import { randomBytes } from "crypto";
import connectDB from "@/lib/mongoose";
import { authOptions } from "@/lib/[...nextauth]";         // adjust path to your [...nextauth] authOptions export
import { s3, BUCKET } from "@/lib/s3";
import FolderShare from "@/models/Foldershare";
import Folder from "@/models/Folder";
import File from "@/models/File";

// ─────────────────────────────────────────────────────────────────────────────
// Expected Folder model fields:  { name, owner_id, ... }
// Expected File model fields:    { folderId, owner_id, status, storageUrl,
//                                  filename, mimetype, size }
// ─────────────────────────────────────────────────────────────────────────────

const REUSE_THRESHOLD_MS = 30 * 60 * 1000;
const SHARE_PERMISSIONS = ["read", "add"] as const;

type LeanId = { _id: { toString(): string } };
type LeanFolderName = { name: string };

// ── Auth helper ───────────────────────────────────────────────────────────────
// Returns the session userId or throws a 401-shaped error.
async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return session.user.id;
}

// ── POST /api/folders/:id/share ───────────────────────────────────────────────
// Creates presigned S3 URLs for all files in the folder for sharing.
//
// Strategy:
// - Uses S3 presigned URLs with configurable expiration (1-30 days, default 7)
// - CloudFront automatically caches each presigned URL for its lifetime
// - When presigned URLs expire, CloudFront stops serving them
// - Idempotent: returns existing share if still valid (> 30 min remaining)
//
// Note: This endpoint is for shared folder access (anyone with token can access).
// For regular user folder downloads, see GET /api/folders/:id/download
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    const { id } = await params;

    

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }

    await connectDB();
    const now = new Date();
    const body = await req.json().catch(() => ({})) as {
      permission?: "read" | "add";
      expiresInDays?: number;
    };
    const permission = SHARE_PERMISSIONS.includes(body.permission as "read" | "add")
      ? body.permission
      : "read";
    const expiresInDays = Math.min(Math.max(Number(body.expiresInDays) || 7, 1), 30);
    const ttlMs = expiresInDays * 24 * 60 * 60 * 1000;
    const ttlSeconds = Math.floor(ttlMs / 1000);

    // ── 1. Verify folder ownership ─────────────────────────────────────────
    const folder = await Folder.findOne({
      _id:      id,
      owner_id: userId,
    }).lean();

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    // ── 2. Return an existing valid share if one exists ────────────────────
    const reuseDeadline = new Date(now.getTime() + REUSE_THRESHOLD_MS);

    const existingShare = await FolderShare.findOne({
      folderId:  id,
      owner_id:  userId,
      permission,
      expiresAt: { $gt: reuseDeadline },
    }).lean();

    if (existingShare) {
      return NextResponse.json({
        shareToken: existingShare.token,
        shareUrl:   buildShareUrl(req, existingShare.token),
        expiresAt:  existingShare.expiresAt,
        fileCount:  existingShare.files?.length ?? 0,
        permission: existingShare.permission ?? "read",
        reused:     true,
      });
    }

    // ── 3. Fetch all uploaded files in the folder ──────────────────────────
    const files = await File.find({
      folderId: id,
      owner_id: userId,
      status:   "uploaded",
    }).lean();

    // ── 4. Presign a view URL for every file ───────────────────────────────
    const expiresAt = new Date(now.getTime() + ttlMs);

    const presignedFiles = await Promise.all(
      files.map(async (file) => {
        const command = new GetObjectCommand({
          Bucket: BUCKET,
          Key:    file.storageUrl,
          ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.filename)}"`,
          ResponseContentType: file.mimetype,
        });

        const url = await getSignedUrl(s3, command, {
          expiresIn: ttlSeconds,
        });

        const fileId = (file as LeanId)._id.toString();

        return {
          fileId,
          filename:    file.filename,
          mimetype:    file.mimetype,
          size:        file.size,
          url,
          downloadUrl: buildDownloadUrl(req, fileId),
        };
      })
    );

    // ── 5. Mint an opaque share token ──────────────────────────────────────
    const token = randomBytes(32).toString("hex");

    // ── 6. Persist the share manifest ─────────────────────────────────────
    await FolderShare.create({
      token,
      folderId:   id,
      folderName: (folder as LeanFolderName).name,
      owner_id:   userId,
      permission,
      files:      presignedFiles,
      expiresAt,
    });

    return NextResponse.json({
      shareToken: token,
      shareUrl:   buildShareUrl(req, token),
      expiresAt,
      fileCount:  presignedFiles.length,
      permission,
      reused:     false,
    });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[POST /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── GET /api/folders/:id/share ────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    const { id } = await params;

    

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }

    await connectDB();

    const share = await FolderShare.findOne(
      {
        folderId:  id,
        owner_id:  userId,
        expiresAt: { $gt: new Date() },
      },
      null,
      { sort: { createdAt: -1 } }
    ).lean();

    if (!share) {
      return NextResponse.json({ active: false });
    }

    return NextResponse.json({
      active:     true,
      shareToken: share.token,
      shareUrl:   buildShareUrl(req, share.token),
      expiresAt:  share.expiresAt,
      fileCount:  share.files?.length ?? 0,
    });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[GET /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── DELETE /api/folders/:id/share ─────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    const { id } = await params;

    

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }

    await connectDB();

    const result = await FolderShare.deleteMany({
      folderId: id,
      owner_id: userId,
    });

    return NextResponse.json({ success: true, revoked: result.deletedCount });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[DELETE /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildShareUrl(req: NextRequest, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return `${base}/share/folder/${token}`;
}

function buildDownloadUrl(req: NextRequest, fileId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return `${base}/api/files/${fileId}/download`;
}

