import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import FileVersionModel from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import User from "@/adapters/database/models/User";
import { computeHash } from "@/server/lib/hash";
import { uploadTelegramChunk } from "@/server/services/storageService";

export interface InitUploadParams {
  filename: string;
  mimeType: string;
  size: number;
  hash: string;
  folderId: string | null;
  fileId?: string;
}

export interface InitUploadResult {
  fileId: string;
  totalChunks: number;
  chunkSize: number;
  isDuplicate: boolean;
  existingFile?: any;
}

const CHUNK_SIZE = 4 * 1024 * 1024;

export async function initTelegramUpload(params: InitUploadParams): Promise<InitUploadResult> {
  const { filename, mimeType, size, hash, folderId, fileId } = params;

  await connectDB();

  let user;
  if (fileId) {
    const existingFile = await File.findOne({
      _id: fileId,
      status: { $in: ["pending", "uploading", "paused"] },
      backend: "telegram",
    }).lean();

    if (!existingFile) {
      throw new Error("Fallback file not found or not in valid state");
    }

    user = await User.findById(existingFile.owner_id);
    if (!user) throw new Error("User not found");

    if (existingFile.hash !== hash) {
      throw new Error("Hash mismatch");
    }

    const totalChunks = existingFile.totalChunks || Math.ceil(size / CHUNK_SIZE);

    return {
      fileId: existingFile._id.toString(),
      totalChunks,
      chunkSize: existingFile.chunkSize || CHUNK_SIZE,
      isDuplicate: false,
    };
  }

  user = await User.findOne({ email: params.filename.split("@")[0] });
  if (!user) {
    throw new Error("Need to pass user context");
  }

  const existingFile = await File.findOne({
    hash,
    owner_id: user._id,
    status: "uploaded",
    backend: "telegram",
  }).lean();

  if (existingFile) {
    return {
      fileId: existingFile._id.toString(),
      totalChunks: Math.ceil(existingFile.size / CHUNK_SIZE),
      chunkSize: CHUNK_SIZE,
      isDuplicate: true,
      existingFile,
    };
  }

  if (!user.hasEnoughStorage(size)) {
    throw new Error("Storage limit exceeded");
  }

  const totalChunks = Math.ceil(size / CHUNK_SIZE);

  const file = await File.create({
    filename,
    hash,
    size,
    mimetype: mimeType || "application/octet-stream",
    owner_id: user._id,
    owner_email: user.email,
    storageUrl: `telegram/${user._id}/${Date.now()}-${filename}`,
    folderId: folderId ?? null,
    folders_id: folderId ?? null,
    backend: "telegram",
    totalChunks,
    chunkSize: CHUNK_SIZE,
    status: "pending",
  });

  return {
    fileId: file._id.toString(),
    totalChunks,
    chunkSize: CHUNK_SIZE,
    isDuplicate: false,
  };
}

export interface ProcessChunkParams {
  fileId: string;
  chunkIndex: number;
  plaintext: Buffer;
  nonceBase64: string;
}

export interface ProcessChunkResult {
  messageId: number;
  telegramFileId: string;
  chunkIndex: number;
  hash: string;
  nonceBase64: string;
  plaintextHash: string;
}

export async function processChunk(params: ProcessChunkParams): Promise<ProcessChunkResult> {
  const { fileId, chunkIndex, plaintext, nonceBase64 } = params;

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) throw new Error("File not found");

  if (file.backend !== "telegram") {
    throw new Error("File is not using Telegram backend");
  }

  if (!["pending", "uploading", "paused"].includes(file.status)) {
    throw new Error(`File is not accepting chunks: ${file.status}`);
  }

  if (file.status === "pending" || file.status === "paused") {
    file.status = "uploading";
    await file.save();
  }

  const existingChunk = await TelegramChunk.findOne({ fileId, chunkIndex });
  if (existingChunk) {
    return {
      messageId: existingChunk.telegramMessageId,
      telegramFileId: existingChunk.telegramFileId,
      chunkIndex,
      hash: existingChunk.hash,
      nonceBase64: existingChunk.nonce,
      plaintextHash: existingChunk.plaintextHash,
    };
  }

  // Backward compat: encrypt with server-side key if present (old method)
  let dataToStore: Buffer;
  let nonce: Buffer;
  if (file.encryptionKey) {
    const { encryptChunkWithNonce } = await import("@/server/services/encryptionService");
    const key = Buffer.from(file.encryptionKey, "base64");
    nonce = Buffer.from(nonceBase64 || "", "base64");
    dataToStore = encryptChunkWithNonce(plaintext, nonce, key);
  } else {
    dataToStore = plaintext;
    nonce = Buffer.alloc(0);
  }

  const plaintextHash = computeHash(plaintext);
  const hash = computeHash(dataToStore);

  const result = await uploadTelegramChunk(
    fileId,
    chunkIndex,
    dataToStore,
    plaintextHash,
    nonceBase64,
    plaintext.length
  );

  return {
    messageId: result.messageId,
    telegramFileId: result.telegramFileId,
    chunkIndex,
    hash: result.chunkData.hash,
    nonceBase64: result.chunkData.nonceBase64,
    plaintextHash: result.chunkData.plaintextHash,
  };
}

export async function completeTelegramUpload(
  fileId: string,
  userId: string
): Promise<{ file: File; version: InstanceType<typeof FileVersionModel> }> {
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) throw new Error("File not found");

  if (file.owner_id.toString() !== userId) {
    throw new Error("Forbidden");
  }

  const chunkCount = await TelegramChunk.countDocuments({ fileId });
  if (chunkCount !== file.totalChunks) {
    throw new Error(`Only ${chunkCount}/${file.totalChunks} chunks uploaded`);
  }

  file.status = "uploaded";
  await file.save();

  await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size } });

  const version = await FileVersionModel.create({
    file_id: file._id,
    version: 1,
    backend: "telegram",
    storageUrl: file.storageUrl,
    hash: file.hash,
    size: file.size,
    mimetype: file.mimetype,
    createdBy: file.owner_id,
  });

  file.currentVersionId = version._id;
  await file.save();

  await TelegramChunk.updateMany(
    { fileId: file._id },
    { $set: { versionId: version._id } }
  );

  return { file, version };
}