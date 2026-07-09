import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import FileVersionModel from "@/adapters/database/models/FileVersion";
import EncryptionKeyModel from "@/adapters/database/models/EncryptionKey";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { ObjectId } from "mongodb";
import { Document } from "mongoose";

export interface DuplicateFileInfo {
  fileId: string;
  versionId: string | null;
  storageUrl: string;
  keyBase64: string;
  mimetype: string;
  size: number;
}

export interface DedupResult {
  isDuplicate: boolean;
  data?: DuplicateFileInfo;
}

export async function checkFileDedup(
  hash: string,
  ownerId: string,
  backend: "s3" | "telegram"
): Promise<DedupResult> {
  await connectDB();

  const existingFile = await File.findOne({
    hash,
    owner_id: ownerId,
    status: "uploaded",
    backend,
  }).lean();

  if (!existingFile) {
    return { isDuplicate: false };
  }

  const versionId = existingFile.currentVersionId;
  const version = versionId
    ? await FileVersionModel.findById(versionId).lean()
    : null;

  if (!version || version.status !== "uploaded") {
    return { isDuplicate: false };
  }

  const encryptionKey = await EncryptionKeyModel.findOne({ fileId: existingFile._id }).lean();

  return {
    isDuplicate: true,
    data: {
      fileId: existingFile._id.toString(),
      versionId: versionId?.toString() ?? null,
      storageUrl: version.storageUrl,
      keyBase64: encryptionKey?.keyBase64 ?? "",
      mimetype: version.mimetype,
      size: version.size,
    },
  };
}

export async function getExistingFileForHash(
  hash: string,
  ownerId: string,
  backend: "s3" | "telegram"
): Promise<InstanceType<typeof File> | null> {
  await connectDB();

  return File.findOne({
    hash,
    owner_id: ownerId,
    status: "uploaded",
    backend,
  }).lean();
}

export async function createFileVersion(
  fileId: string,
  versionNumber: number,
  backend: "s3" | "telegram",
  storageUrl: string,
  hash: string,
  size: number,
  mimetype: string,
  createdBy: ObjectId
): Promise<InstanceType<typeof FileVersionModel>> {
  await connectDB();

  return FileVersionModel.create({
    file_id: fileId,
    version: versionNumber,
    backend,
    storageUrl,
    hash,
    size,
    mimetype,
    createdBy,
  });
}

export async function storeEncryptionKey(
  fileId: string,
  keyBase64: string
): Promise<InstanceType<typeof EncryptionKeyModel>> {
  await connectDB();

  return EncryptionKeyModel.create({
    fileId,
    keyBase64,
    algorithm: "aes-256-gcm",
  });
}

export async function getEncryptionKey(fileId: string): Promise<string | null> {
  await connectDB();

  const key = await EncryptionKeyModel.findOne({ fileId }).lean();
  return key?.keyBase64 ?? null;
}

export async function deleteEncryptionKey(fileId: string): Promise<void> {
  await connectDB();
  await EncryptionKeyModel.deleteOne({ fileId });
}

export interface ChunkDedupResult {
  isDuplicate: boolean;
  chunkIndex: number;
  hash: string;
  plaintextHash: string;
  nonceBase64: string;
}

export async function checkChunkDedup(
  fileId: string,
  chunkIndex: number
): Promise<ChunkDedupResult | null> {
  await connectDB();

  const existing = await TelegramChunk.findOne({ fileId, chunkIndex }).lean();
  if (!existing) return null;

  return {
    isDuplicate: true,
    chunkIndex: existing.chunkIndex,
    hash: existing.hash,
    plaintextHash: existing.plaintextHash,
    nonceBase64: existing.nonce,
  };
}