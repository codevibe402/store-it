// app/api/folders/[id]/route.ts
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
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

// PATCH /api/folders/:id
// Body: { parentId: string | null }
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !("parentId" in body)) {
      return NextResponse.json({ error: "parentId is required" }, { status: 400 });
    }

    const { parentId } = body as { parentId: string | null };

    if (parentId !== null && !ObjectId.isValid(parentId)) {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }

    if (parentId === id) {
      return NextResponse.json({ error: "A folder cannot be moved into itself" }, { status: 400 });
    }

    await connectMongoose();

    const folder = await Folder.findOne({ _id: id, owner_id: userId }).lean();
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    if (parentId !== null) {
      const targetFolder = await Folder.findOne({ _id: parentId, owner_id: userId }).lean();
      if (!targetFolder) {
        return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
      }
    }

    const updated = await Folder.findOneAndUpdate(
      { _id: id, owner_id: userId },
      { $set: { parent_id: parentId ?? null, updatedAt: new Date() } },
      { new: true }
    ).lean();

    return NextResponse.json({ folder: updated });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[PATCH /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/folders/:id
// ?deleteFiles=true permanently deletes files in the folder.
// Omit deleteFiles to move contained files and child folders to root.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }

    await connectMongoose();
    const deleteFiles = req.nextUrl.searchParams.get("deleteFiles") === "true";

    const folder = await Folder.findOne({
      _id: id,
      owner_id: userId,
    }).lean();

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const fileCount = await File.countDocuments({
      $or: [{ folderId: id }, { folders_id: id }],
      owner_id: userId,
      status: "uploaded",
    });

    if (deleteFiles && fileCount > 0) {
      const containedFiles = await File.find({
        $or: [{ folderId: id }, { folders_id: id }],
        owner_id: userId,
        status: "uploaded",
      }).lean();

      const s3Files = containedFiles.filter((f) => f.backend !== "telegram");
      const telegramFiles = containedFiles.filter((f) => f.backend === "telegram");

      if (s3Files.length > 0) {
        const s3Keys = s3Files.map((file) => ({ Key: file.storageUrl }));
        for (let i = 0; i < s3Keys.length; i += 1000) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: BUCKET,
              Delete: { Objects: s3Keys.slice(i, i + 1000), Quiet: true },
            })
          );
        }
      }

      for (const tf of telegramFiles) {
        const chunks = await TelegramChunk.find({ fileId: tf._id });
        for (const chunk of chunks) {
          try { await deleteMessage(chunk.telegramMessageId); } catch {}
        }
        await TelegramChunk.deleteMany({ fileId: tf._id });
      }

      await File.deleteMany({
        $or: [{ folderId: id }, { folders_id: id }],
        owner_id: userId,
      });
    } else if (!deleteFiles) {
      await File.updateMany(
        { $or: [{ folderId: id }, { folders_id: id }], owner_id: userId },
        { $set: { folderId: null, folders_id: null } }
      );
    }

    const movedChildFolders = await Folder.updateMany(
      { parent_id: id, owner_id: userId },
      { $set: { parent_id: null } }
    );

    await Folder.deleteOne({ _id: id, owner_id: userId });

    return NextResponse.json({
      success: true,
      deletedFiles: deleteFiles ? fileCount : 0,
      movedToRoot: deleteFiles ? 0 : fileCount,
      movedFoldersToRoot: movedChildFolders.modifiedCount,
    });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[DELETE /api/folders/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
