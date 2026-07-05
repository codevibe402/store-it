import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { ObjectId } from "mongodb";
import JSZip from "jszip";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import connectDB from "@/adapters/database/mongoose";
import { BUCKET, s3 } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { deleteMessage } from "@/adapters/storage/telegram";
import { ServiceError } from "./shareService";

export async function createFolder(userId: string, userEmail: string, name: string, parentId?: string | null) {
  if (!name?.trim()) throw new ServiceError("Folder name required", 400);
  await connectDB();

  return Folder.create({
    name: name.trim(),
    owner_id: userId,
    owner_email: userEmail,
    parent_id: parentId || null,
  });
}

export async function getFolders(userEmail: string) {
  await connectDB();

  return Folder.find({ owner_email: userEmail })
    .select("name owner_id parent_id createdAt _id")
    .sort({ createdAt: -1 })
    .lean();
}

export async function moveFolder(userId: string, folderId: string, parentId: string | null) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  if (parentId !== null && !ObjectId.isValid(parentId)) throw new ServiceError("Invalid parentId", 400);
  if (parentId === folderId) throw new ServiceError("A folder cannot be moved into itself", 400);

  await connectDB();

  const folder = await Folder.findOne({ _id: folderId, owner_id: userId }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  if (parentId !== null) {
    const target = await Folder.findOne({ _id: parentId, owner_id: userId }).lean();
    if (!target) throw new ServiceError("Target folder not found", 404);
  }

  return Folder.findOneAndUpdate(
    { _id: folderId, owner_id: userId },
    { $set: { parent_id: parentId ?? null, updatedAt: new Date() } },
    { new: true }
  ).lean();
}

export async function deleteFolder(userId: string, folderId: string, deleteFiles: boolean) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);

  await connectDB();

  const folder = await Folder.findOne({ _id: folderId, owner_id: userId }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  const fileCount = await File.countDocuments({
    $or: [{ folderId }, { folders_id: folderId }],
    owner_id: userId,
    status: "uploaded",
  });

  if (deleteFiles && fileCount > 0) {
    const containedFiles = await File.find({
      $or: [{ folderId }, { folders_id: folderId }],
      owner_id: userId,
      status: "uploaded",
    }).lean();

    const s3Files = containedFiles.filter((f) => f.backend !== "telegram");
    const telegramFiles = containedFiles.filter((f) => f.backend === "telegram");

    if (s3Files.length > 0) {
      const s3Keys = s3Files.map((f) => ({ Key: f.storageUrl }));
      for (let i = 0; i < s3Keys.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: s3Keys.slice(i, i + 1000), Quiet: true } }));
      }
    }

    for (const tf of telegramFiles) {
      const chunks = await TelegramChunk.find({ fileId: tf._id });
      for (const chunk of chunks) {
        try { await deleteMessage(chunk.telegramMessageId); } catch {}
      }
      await TelegramChunk.deleteMany({ fileId: tf._id });
    }

    await File.deleteMany({ $or: [{ folderId }, { folders_id: folderId }], owner_id: userId });
  } else if (!deleteFiles) {
    await File.updateMany(
      { $or: [{ folderId }, { folders_id: folderId }], owner_id: userId },
      { $set: { folderId: null, folders_id: null } }
    );
  }

  await Folder.updateMany({ parent_id: folderId, owner_id: userId }, { $set: { parent_id: null } });
  await Folder.deleteOne({ _id: folderId, owner_id: userId });

  return { deletedFiles: deleteFiles ? fileCount : 0, movedToRoot: deleteFiles ? 0 : fileCount };
}

export async function downloadFolderAsZip(userId: string, folderId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);

  await connectDB();

  const folder = await Folder.findOne({ _id: folderId, owner_id: userId }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  const files = await File.find({ folderId, owner_id: userId, status: "uploaded" }).lean();
  if (files.length === 0) throw new ServiceError("Folder is empty", 400);

  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  await Promise.all(
    files.map(async (file) => {
      try {
        const s3Res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: file.storageUrl }));
        const chunks: Uint8Array[] = [];
        for await (const chunk of s3Res.Body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        const base = file.filename as string;
        const count = usedNames.get(base) ?? 0;
        const name = count === 0 ? base : dedupName(base, count);
        usedNames.set(base, count + 1);

        zip.file(name, buffer);
      } catch (err) {
        console.error(`[ZIP] Failed to fetch S3 key ${file.storageUrl}`, err);
      }
    })
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

  return { zipBuffer, folderName: folder.name as string };
}

function dedupName(original: string, count: number): string {
  const dot = original.lastIndexOf(".");
  if (dot === -1) return `${original} (${count})`;
  return `${original.slice(0, dot)} (${count})${original.slice(dot)}`;
}
