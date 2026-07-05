import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import crypto from "crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import FileShare from "@/adapters/database/models/Fileshare";

const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHARE_TTL_MS      = SHARE_TTL_SECONDS * 1000;

async function getUserId(): Promise<string> {
  const user = await getAuthUser();
  if (!user?.userId) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user.userId;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

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

    const file = await File.findOne({
      _id:      id,
      owner_id: userId,
      status:   "uploaded",
    }).lean();

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

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

    const isTelegram = file.backend === "telegram";
    let shareUrl: string;

    if (isTelegram) {
      const token = generateToken();
      const base  = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      shareUrl = `${base}/api/share/file/${token}`;

      const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);

      await FileShare.create({
        fileId:     id,
        filename:   file.filename,
        owner_id:   userId,
        shareUrl,
        shareToken: token,
        backend:    "telegram",
        expiresAt,
      });

      return NextResponse.json({ shareUrl, expiresAt, reused: false });
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key:    file.storageUrl,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.filename)}"`,
      ResponseContentType: file.mimetype,
    });

    shareUrl = await getSignedUrl(s3, command, {
      expiresIn: SHARE_TTL_SECONDS,
    });

    const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);

    await FileShare.create({
      fileId:     id,
      filename:   file.filename,
      owner_id:   userId,
      shareUrl,
      shareToken: generateToken(),
      backend:    "s3",
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
