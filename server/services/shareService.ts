import crypto from "crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectId } from "mongodb";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import FileShare from "@/adapters/database/models/Fileshare";
import FolderShare from "@/adapters/database/models/Foldershare";
import Folder from "@/adapters/database/models/Folder";
import User from "@/adapters/database/models/User";
import Permission from "@/adapters/database/models/Permission";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import { createS3DownloadUrl, createTelegramDownloadStream } from "@/server/lib/download";
import { createHash } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { extractSearchText } from "@/server/lib/fileText";

const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHARE_TTL_MS = SHARE_TTL_SECONDS * 1000;
const REUSE_THRESHOLD_MS = 30 * 60 * 1000;
const SHARE_PERMISSIONS = ["read", "add"] as const;

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ServiceError";
  }
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ── File Share ───────────────────────────────────────────────────────────────

export async function createFileShare(userId: string, fileId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);

  await connectDB();
  const now = new Date();

  const file = await File.findOne({ _id: fileId, owner_id: userId, status: "uploaded" }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  const minRemaining = new Date(now.getTime() + 30 * 60 * 1000);
  const existing = await FileShare.findOne({ fileId, owner_id: userId, expiresAt: { $gt: minRemaining } }).lean();
  if (existing) {
    return { shareUrl: existing.shareUrl, expiresAt: existing.expiresAt, reused: true as const };
  }

  const isTelegram = file.backend === "telegram";
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);

  if (isTelegram) {
    const token = generateToken();
    const base = process.env.NEXT_PUBLIC_APP_URL ;
    const shareUrl = `${base}/api/share/file/${token}`;
    await FileShare.create({ fileId, filename: file.filename, owner_id: userId, shareUrl, shareToken: token, backend: "telegram", expiresAt });
    return { shareUrl, expiresAt, reused: false as const };
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: file.storageUrl,
    ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.filename)}"`,
    ResponseContentType: file.mimetype,
  });
  const shareUrl = await getSignedUrl(s3, command, { expiresIn: SHARE_TTL_SECONDS });
  await FileShare.create({ fileId, filename: file.filename, owner_id: userId, shareUrl, shareToken: generateToken(), backend: "s3", expiresAt });
  return { shareUrl, expiresAt, reused: false as const };
}

export async function revokeFileShares(userId: string, fileId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);
  await connectDB();
  return FileShare.deleteMany({ fileId, owner_id: userId });
}

export async function getSharedFileByToken(token: string, versionId?: string | null) {
  await connectDB();

  const share = await FileShare.findOne({ shareToken: token, expiresAt: { $gt: new Date() } }).lean();
  if (!share) throw new ServiceError("Share link not found or expired", 404);

  if (share.backend === "s3") {
    return { kind: "redirect" as const, url: share.shareUrl as string };
  }

  const file = await File.findOne({ _id: share.fileId, status: "uploaded" }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  let version;
  if (versionId) {
    version = await FileVersion.findById(versionId).lean();
  } else if (file.currentVersionId) {
    version = await FileVersion.findById(file.currentVersionId).lean();
  }
  if (!version) throw new ServiceError("Version not found", 404);

  if (version.backend === "telegram") {
    const encryptionKey = await EncryptionKey.findOne({ fileId: file._id }).lean();
    return { 
      kind: "stream" as const, 
      versionId: version._id.toString(), 
      size: version.size, 
      mimetype: version.mimetype, 
      filename: file.filename,
      encryptionKeyBase64: encryptionKey?.keyBase64,
    };
  }

  const url = await createS3DownloadUrl(version.storageUrl, file.filename, version.mimetype);
  return { kind: "redirect" as const, url };
}

// ── Folder Share ─────────────────────────────────────────────────────────────

export async function createFolderShare(userId: string, folderId: string, permission: string, expiresInDays: number) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);

  await connectDB();
  const now = new Date();

  const folder = await Folder.findOne({ _id: folderId, owner_id: userId }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  const perm = SHARE_PERMISSIONS.includes(permission as "read" | "add") ? permission : "read";
  const days = Math.min(Math.max(Number(expiresInDays) || 7, 1), 30);
  const ttlMs = days * 24 * 60 * 60 * 1000;

  const reuseDeadline = new Date(now.getTime() + REUSE_THRESHOLD_MS);
  const existing = await FolderShare.findOne({ folderId, owner_id: userId, permission: perm, expiresAt: { $gt: reuseDeadline } }).lean();
  if (existing) {
    return { shareToken: existing.token, shareUrl: buildFolderShareUrl(existing.token), expiresAt: existing.expiresAt, permission: existing.permission ?? "read", reused: true as const };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + ttlMs);

  await FolderShare.create({ token, tokenHash, folderId, folderName: folder.name, owner_id: userId, permission: perm, expiresAt, allowVersionHistory: false });

  return { shareToken: token, shareUrl: buildFolderShareUrl(token), expiresAt, permission: perm, reused: false as const };
}

export async function getFolderShare(userId: string, folderId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  await connectDB();

  const share = await FolderShare.findOne(
    { folderId, owner_id: userId, expiresAt: { $gt: new Date() } },
    null,
    { sort: { createdAt: -1 } }
  ).lean();

  if (!share) return { active: false as const };
  return { active: true as const, shareToken: share.token, shareUrl: buildFolderShareUrl(share.token), expiresAt: share.expiresAt };
}

export async function revokeFolderShares(userId: string, folderId: string) {
  if (!ObjectId.isValid(folderId)) throw new ServiceError("Invalid folder id", 400);
  await connectDB();
  return FolderShare.deleteMany({ folderId, owner_id: userId });
}

export async function getSharedFolderContents(token: string) {
  await connectDB();

  const share = await FolderShare.findOne({ token, expiresAt: { $gt: new Date() } }).lean();
  if (!share) throw new ServiceError("Share link not found or expired", 404);

  const files = await File.find({ folderId: share.folderId, owner_id: share.owner_id, status: "uploaded" })
    .sort({ createdAt: -1 })
    .lean();

  return {
    folderName: share.folderName,
    permission: share.permission,
    expiresAt: share.expiresAt,
    allowVersionHistory: share.allowVersionHistory,
    files: files.map((f) => ({
      fileId: f._id.toString(),
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
      backend: f.backend,
      downloadUrl: `/api/share/folder/${token}/files/${f._id}/download`,
    })),
  };
}

export async function createFolderInSharedFolder(token: string, name: string) {
  if (!name?.trim()) throw new ServiceError("Folder name required", 400);

  await connectDB();

  const share = await FolderShare.findOne({ token, permission: "add", expiresAt: { $gt: new Date() } }).lean();
  if (!share) throw new ServiceError("This share link cannot add folders", 403);

  const owner = await User.findById(share.owner_id).lean();

  const folder = await Folder.create({
    name: name.trim(),
    owner_id: share.owner_id,
    owner_email: owner?.email ?? "",
    parent_id: share.folderId,
  });

  return folder;
}

export async function getSharedFileDownload(token: string, fileId: string) {
  await connectDB();

  const share = await FolderShare.findOne({ token, expiresAt: { $gt: new Date() }, revokedAt: null }).lean();
  if (!share) throw new ServiceError("Share link not found or expired", 404);

  const file = await File.findOne({ _id: fileId, folderId: share.folderId, owner_id: share.owner_id, status: "uploaded" }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  if (share.maxDownloads && share.downloadCount >= share.maxDownloads) {
    throw new ServiceError("Download limit reached", 403);
  }

  await FolderShare.updateOne({ token }, { $inc: { downloadCount: 1 } });

  let version;
  if (file.currentVersionId) {
    version = await FileVersion.findById(file.currentVersionId).lean();
  }

  if (!version) {
    if (file.backend === "telegram") throw new ServiceError("Version not found for Telegram download", 404);
    const url = await createS3DownloadUrl(file.storageUrl, file.filename, file.mimetype);
    return { kind: "redirect" as const, url };
  }

  if (version.backend === "telegram") {
    const encryptionKey = await EncryptionKey.findOne({ fileId: file._id }).lean();
    return { 
      kind: "stream" as const, 
      versionId: version._id.toString(), 
      size: version.size, 
      mimetype: version.mimetype, 
      filename: file.filename,
      encryptionKeyBase64: encryptionKey?.keyBase64,
    };
  }

  const url = await createS3DownloadUrl(version.storageUrl, file.filename, version.mimetype);
  return { kind: "redirect" as const, url };
}

export async function uploadToSharedFolder(token: string, uploadedFile: File) {
  await connectDB();

  const share = await FolderShare.findOne({ token, permission: "add", expiresAt: { $gt: new Date() } }).lean();
  if (!share) throw new ServiceError("This share link cannot add files", 403);

  const user = await User.findById(share.owner_id);
  if (!user) throw new ServiceError("Owner not found", 404);

  const filename = uploadedFile.name;
  const mimeType = uploadedFile.type || "application/octet-stream";
  const size = uploadedFile.size;
  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");

  if (!user.hasEnoughStorage(size)) throw new ServiceError("Storage limit exceeded", 413);

  let resolvedFilename = filename;
  let conflict = true;
  for (let attempt = 1; conflict; attempt++) {
    const existing = await File.findOne({ filename: resolvedFilename, folderId: share.folderId, owner_id: user._id, status: "uploaded" }).lean();
    if (!existing) {
      conflict = false;
    } else {
      const ext = filename.lastIndexOf(".");
      if (ext > 0) {
        resolvedFilename = `${filename.slice(0, ext)} (shared upload ${attempt})${filename.slice(ext)}`;
      } else {
        resolvedFilename = `${filename} (shared upload ${attempt})`;
      }
    }
  }

  const key = `uploads/${user._id}/${Date.now()}-${resolvedFilename}`;
  const searchText = await extractSearchText(buffer, resolvedFilename, mimeType);

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType, ContentLength: size }));

  const file = await File.create({
    filename: resolvedFilename, hash, owner_email: user.email, owner_id: user._id,
    mimetype: mimeType, size, searchText,
    textIndexedAt: searchText ? new Date() : null,
    storageUrl: key, backend: "s3",
    folders_id: share.folderId, folderId: share.folderId,
    status: "uploaded",
  });

  const version = await FileVersion.create({
    file_id: file._id, version: 1, backend: "s3",
    storageUrl: key, hash, size, mimetype: mimeType, createdBy: user._id,
  });

  file.currentVersionId = version._id;
  await file.save();

  await User.findByIdAndUpdate(user._id, { $inc: { storageused: size } });

  return file;
}

// ── Permission-based Share ───────────────────────────────────────────────────

const PERMISSIONS = ["read", "write", "admin"] as const;

export async function shareWithUser(currentUserId: string, resourceId: string, resourceType: "file" | "folder", permission: string, sharedWithEmail?: string, sharedWithUserId?: string) {
  if (!ObjectId.isValid(resourceId)) throw new ServiceError("Valid resourceId is required", 400);
  if (!PERMISSIONS.includes(permission as "read" | "write" | "admin")) throw new ServiceError("permission must be read, write, or admin", 400);
  if (!sharedWithEmail && !sharedWithUserId) throw new ServiceError("sharedWithEmail or sharedWithUserId is required", 400);

  await connectDB();

  const Model = resourceType === "file" ? File : Folder;
  const resource = await Model.findById(resourceId).lean();
  if (!resource) throw new ServiceError("Resource not found", 404);

  const ownerId = (resource as { owner_id?: { toString(): string } | string }).owner_id?.toString();
  if (ownerId !== currentUserId) {
    const adminPermission = await Permission.exists({ sharedwith: currentUserId, resource_id: resourceId, resource_type: resourceType, permission: "admin" });
    if (!adminPermission) throw new ServiceError("Forbidden", 403);
  }

  const sharedWithUser = sharedWithUserId
    ? await User.findById(sharedWithUserId).lean()
    : await User.findOne({ email: sharedWithEmail?.toLowerCase().trim() }).lean();
  if (!sharedWithUser) throw new ServiceError("User to share with not found", 404);

  const sharedWithId = sharedWithUser._id.toString();
  if (sharedWithId === currentUserId) throw new ServiceError("You cannot share a resource with yourself", 400);

  const perm = await Permission.findOneAndUpdate(
    { sharedwith: sharedWithId, resource_id: resourceId, resource_type: resourceType },
    { $set: { sharedwith: sharedWithId, resource_id: resourceId, resource_type: resourceType, permission } },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return perm;
}

export async function getResourcePermissions(currentUserId: string, resourceId: string, resourceType: "file" | "folder") {
  if (!ObjectId.isValid(resourceId)) throw new ServiceError("Valid resourceId is required", 400);

  await connectDB();

  const Model = resourceType === "file" ? File : Folder;
  const resource = await Model.findById(resourceId).lean();
  if (!resource) throw new ServiceError("Resource not found", 404);

  const ownerId = (resource as { owner_id?: { toString(): string } | string }).owner_id?.toString();
  if (ownerId !== currentUserId) {
    const adminPermission = await Permission.exists({ sharedwith: currentUserId, resource_id: resourceId, resource_type: resourceType, permission: "admin" });
    if (!adminPermission) throw new ServiceError("Forbidden", 403);
  }

  const permissions = await Permission.find({ resource_id: resourceId, resource_type: resourceType })
    .populate("sharedwith", "name email")
    .sort({ updatedAt: -1 })
    .lean();

  return permissions;
}

export async function revokeUserPermission(currentUserId: string, resourceId: string, resourceType: "file" | "folder", sharedWithUserId: string) {
  if (!ObjectId.isValid(resourceId)) throw new ServiceError("Valid resourceId is required", 400);
  if (!ObjectId.isValid(sharedWithUserId)) throw new ServiceError("Valid sharedWithUserId is required", 400);

  await connectDB();

  const Model = resourceType === "file" ? File : Folder;
  const resource = await Model.findById(resourceId).lean();
  if (!resource) throw new ServiceError("Resource not found", 404);

  const ownerId = (resource as { owner_id?: { toString(): string } | string }).owner_id?.toString();
  if (ownerId !== currentUserId) {
    const adminPermission = await Permission.exists({ sharedwith: currentUserId, resource_id: resourceId, resource_type: resourceType, permission: "admin" });
    if (!adminPermission) throw new ServiceError("Forbidden", 403);
  }

  return Permission.deleteOne({ sharedwith: sharedWithUserId, resource_id: resourceId, resource_type: resourceType });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildFolderShareUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/share/folder/${token}`;
}
