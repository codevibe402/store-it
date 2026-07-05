// app/api/files/[id]/route.ts
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/[...nextauth]";
import connectMongoose from "@/lib/mongoose";
import { BUCKET, s3 } from "@/lib/s3";
import File from "@/models/File";
import Folder from "@/models/Folder";
import TelegramChunk from "@/models/TelegramChunk";
import { deleteMessage } from "@/lib/telegram";

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return session.user.id;
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

// PATCH /api/files/:id
// Body: { folderId: string | null }
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !("folderId" in body)) {
      return NextResponse.json({ error: "folderId is required" }, { status: 400 });
    }

    const { folderId } = body as { folderId: string | null };

    await connectMongoose();

    const file = await File.findOne({
      _id: id,
      owner_id: userId,
    }).lean();

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (folderId !== null) {
      if (!ObjectId.isValid(folderId)) {
        return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
      }

      const folder = await Folder.findOne({
        _id: folderId,
        owner_id: userId,
      }).lean();

      if (!folder) {
        return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
      }
    }

    const updated = await File.findOneAndUpdate(
      { _id: id, owner_id: userId },
      {
        $set: {
          folderId: folderId ?? null,
          folders_id: folderId ?? null,
          updatedAt: new Date(),
        },
      },
      { new: true }
    ).lean();

    return NextResponse.json({ file: updated });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[PATCH /api/files/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/files/:id
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    }

    await connectMongoose();

    const file = await File.findOne({
      _id: id,
      owner_id: userId,
    }).lean();

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (file.backend === "telegram") {
      const chunks = await TelegramChunk.find({ fileId: id });
      for (const chunk of chunks) {
        try { await deleteMessage(chunk.telegramMessageId); } catch {}
      }
      await TelegramChunk.deleteMany({ fileId: id });
    } else {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.storageUrl }));
    }

    await File.deleteOne({ _id: id, owner_id: userId });

    return NextResponse.json({ success: true, deleted: file.filename });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[DELETE /api/files/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
