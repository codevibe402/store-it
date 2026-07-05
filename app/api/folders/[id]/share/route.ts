// app/api/folders/[id]/share/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthUser } from "@/server/auth/auth";
import { randomBytes } from "crypto";
import connectDB from "@/adapters/database/mongoose";
import FolderShare from "@/adapters/database/models/Foldershare";
import Folder from "@/adapters/database/models/Folder";

const REUSE_THRESHOLD_MS = 30 * 60 * 1000;
const SHARE_PERMISSIONS = ["read", "add"] as const;

async function getUserId(): Promise<string> {
  const user = await getAuthUser();
  if (!user?.userId) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user.userId;
}

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

    const folder = await Folder.findOne({
      _id: id,
      owner_id: userId,
    }).lean();

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const reuseDeadline = new Date(now.getTime() + REUSE_THRESHOLD_MS);
    const existingShare = await FolderShare.findOne({
      folderId: id,
      owner_id: userId,
      permission,
      expiresAt: { $gt: reuseDeadline },
    }).lean();

    if (existingShare) {
      return NextResponse.json({
        shareToken: existingShare.token,
        shareUrl: buildShareUrl(req, existingShare.token),
        expiresAt: existingShare.expiresAt,
        permission: existingShare.permission ?? "read",
        reused: true,
      });
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = randomBytes(16).toString("hex");
    const expiresAt = new Date(now.getTime() + ttlMs);

    await FolderShare.create({
      token,
      tokenHash,
      folderId: id,
      folderName: (folder as { name: string }).name,
      owner_id: userId,
      permission,
      expiresAt,
      allowVersionHistory: false,
    });

    return NextResponse.json({
      shareToken: token,
      shareUrl: buildShareUrl(req, token),
      expiresAt,
      permission,
      reused: false,
    });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[POST /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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
        folderId: id,
        owner_id: userId,
        expiresAt: { $gt: new Date() },
      },
      null,
      { sort: { createdAt: -1 } }
    ).lean();

    if (!share) {
      return NextResponse.json({ active: false });
    }

    return NextResponse.json({
      active: true,
      shareToken: share.token,
      shareUrl: buildShareUrl(req, share.token),
      expiresAt: share.expiresAt,
    });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[GET /api/folders/:id/share]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

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

function buildShareUrl(req: NextRequest, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return `${base}/share/folder/${token}`;
}

