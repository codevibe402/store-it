import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ObjectId } from "mongodb";
import connectDB from "@/adapters/database/mongoose";
import { BUCKET, s3 } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import FileVersionModel from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import User from "@/adapters/database/models/User";
import { deleteMessage } from "@/adapters/storage/telegram";
import { createS3DownloadUrl, createTelegramDownloadStream } from "@/server/lib/download";
import { ServiceError } from "./shareService";
import EncryptionKeyModel from "@/adapters/database/models/EncryptionKey";

export async function moveFile(userId: string, fileId: string, folderId: string | null) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  if (folderId !== null) {
    if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folderId", 400);
    const folder = await Folder.findOne({ _id: folderId, owner_id: userId, deleted: { $ne: true } }).lean();
    if (!folder) throw new ServiceError("Target folder not found", 404);
  }

  return File.findOneAndUpdate(
    { _id: fileId, owner_id: userId },
    { $set: { folderId: folderId ?? null, folders_id: folderId ?? null, updatedAt: new Date() } },
    { new: true }
  ).lean();
}

export async function renameFile(userId: string, fileId: string, body: { filename?: string; folderId?: string | null }) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  
  if (body.filename !== undefined) {
    update.filename = body.filename;
  }
  
  if (body.folderId !== undefined) {
    if (body.folderId !== null && !ObjectId.isValid(body.folderId)) {
      throw new ServiceError("Invalid folderId", 400);
    }
    if (body.folderId !== null) {
      const folder = await Folder.findOne({ _id: body.folderId, owner_id: userId, deleted: { $ne: true } }).lean();
      if (!folder) throw new ServiceError("Target folder not found", 404);
    }
    update.folderId = body.folderId;
    update.folders_id = body.folderId;
  }

  return File.findOneAndUpdate(
    { _id: fileId, owner_id: userId },
    { $set: update },
    { new: true }
  ).lean();
}

export async function deleteFile(userId: string, fileId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  await File.findByIdAndUpdate(fileId, { deleted: true, deletedAt: new Date() });
  return file.filename;
}

export async function hardDeleteFile(userId: string, fileId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId, deleted: true }).lean();
  if (!file) throw new ServiceError("File not found in recycle bin", 404);

  if (file.backend === "telegram") {
    const chunks = await TelegramChunk.find({ fileId });
    for (const chunk of chunks) {
      try { await deleteMessage(chunk.telegramMessageId); } catch {}
    }
    await TelegramChunk.deleteMany({ fileId });
  } else {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.storageUrl }));
  }

  try { await EncryptionKeyModel.deleteOne({ fileId: file._id }); } catch {}
  await FileVersionModel.deleteMany({ file_id: file._id });
  await File.deleteOne({ _id: fileId, owner_id: userId });
  return file.filename;
}

export async function getRecycleBinFiles(userId: string) {
  await connectDB();
  return File.find({ owner_id: userId, deleted: true })
    .sort({ deletedAt: -1 })
    .lean();
}

export async function restoreFile(userId: string, fileId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId, deleted: true }).lean();
  if (!file) throw new ServiceError("File not found in recycle bin", 404);

  await File.findByIdAndUpdate(fileId, { deleted: false, deletedAt: null });
  return file;
}

export async function confirmFile(userId: string, fileId: string) {
  if (!fileId) throw new ServiceError("fileId is required", 400);
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) throw new ServiceError("File not found", 404);
  if (String(file.owner_id) !== userId) throw new ServiceError("Forbidden", 403);

  if (file.status === "uploaded") return file;

  file.status = "uploaded";
  await file.save();

  await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size } });
  return file;
}

export async function getFileDownload(userId: string, fileId: string, preview: boolean, versionId?: string | null) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId, status: "uploaded" }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  let version;
  if (versionId) {
    version = await FileVersionModel.findById(versionId).lean();
  } else if (file.currentVersionId) {
    version = await FileVersionModel.findById(file.currentVersionId).lean();
  }

  if (version?.backend === "telegram") {
    // Backward compat: look for server-side key for old files
    const encryptionKey = file.encryptionKey
      ? await EncryptionKeyModel.findOne({ fileId: file._id }).lean()
      : null;
    return {
      kind: "stream" as const,
      versionId: version._id.toString(),
      size: version.size,
      mimetype: preview ? file.mimetype : version.mimetype,
      filename: file.filename,
      disposition: preview ? "inline" as const : "attachment" as const,
      encryptionKeyBase64: encryptionKey?.keyBase64,
    };
  }

  const storageUrl = version?.storageUrl ?? file.storageUrl;
  const disposition = preview ? "inline" : "attachment";
  const url = await createS3DownloadUrl(storageUrl, file.filename, file.mimetype, disposition as "inline" | "attachment");

  return { kind: "redirect" as const, url };
}

// Describes how to fetch+decrypt a file client-side. Only telegram-backed
// files encrypted with the account's zero-knowledge DEK (encryptionMode ===
// 'dek') need this — everything else is served by the existing download
// route (server-decrypted, or never encrypted, or S3-redirected).
export async function getFileManifest(userId: string, fileId: string, versionId?: string | null) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId, status: "uploaded" }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  let version;
  if (versionId) {
    version = await FileVersionModel.findById(versionId).lean();
  } else if (file.currentVersionId) {
    version = await FileVersionModel.findById(file.currentVersionId).lean();
  }

  const requiresClientDecrypt = version?.backend === "telegram" && file.encryptionMode === "dek";

  if (!requiresClientDecrypt) {
    return { requiresClientDecrypt: false as const };
  }

  const chunks = await TelegramChunk.find({ versionId: version!._id })
    .sort({ chunkIndex: 1 })
    .select("chunkIndex nonce size")
    .lean();

  return {
    requiresClientDecrypt: true as const,
    versionId: version!._id.toString(),
    filename: file.filename,
    mimetype: version!.mimetype,
    totalSize: version!.size,
    chunks: chunks.map((c) => ({ index: c.chunkIndex, nonce: c.nonce, size: c.size })),
  };
}

// Raw ciphertext bytes for one chunk — never decrypted server-side, since
// for 'dek'-mode files the server never has the key. Ownership is checked
// via the parent File the same way as every other file endpoint.
export async function getFileChunkData(userId: string, fileId: string, versionId: string, chunkIndex: number) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();

  const file = await File.findOne({ _id: fileId, owner_id: userId, status: "uploaded" }).lean();
  if (!file) throw new ServiceError("File not found", 404);
  if (file.encryptionMode !== "dek") throw new ServiceError("File does not require client-side decryption", 409);

  const chunk = await TelegramChunk.findOne({ versionId, chunkIndex }).lean();
  if (!chunk) throw new ServiceError("Chunk not found", 404);

  return chunk;
}

export async function checkDuplicateFile(
  userId: string,
  hash: string,
  backend: "s3" | "telegram" = "s3"
) {
  await connectDB();

  const file = await File.findOne({
    hash,
    owner_id: userId,
    status: "uploaded",
    backend,
  }).lean();

  return file;
}