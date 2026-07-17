import crypto from "crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectId } from "mongodb";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import FileShare from "@/adapters/database/models/Fileshare";
import User from "@/adapters/database/models/User";
import Permission from "@/adapters/database/models/Permission";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import { createS3DownloadUrl } from "@/server/lib/download";

const SHARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SHARE_TTL_MS = SHARE_TTL_SECONDS * 1000;

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

// ── File permission-based sharing (non-link) ─────────────────────────────────
// Folder sharing no longer uses this Permission model at all — see
// server/services/permissionService.ts for the inheritance-aware
// FolderPermission/ShareLink engine. This is kept only for direct
// file-to-user grants, which are out of scope for the folder-sharing
// redesign.

const FILE_PERMISSIONS = ["read", "write", "admin"] as const;

export async function shareFileWithUser(currentUserId: string, fileId: string, permission: string, sharedWithEmail?: string, sharedWithUserId?: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Valid fileId is required", 400);
  if (!FILE_PERMISSIONS.includes(permission as "read" | "write" | "admin")) throw new ServiceError("permission must be read, write, or admin", 400);
  if (!sharedWithEmail && !sharedWithUserId) throw new ServiceError("sharedWithEmail or sharedWithUserId is required", 400);

  await connectDB();

  const resource = await File.findById(fileId).lean();
  if (!resource) throw new ServiceError("Resource not found", 404);

  const ownerId = (resource as { owner_id?: { toString(): string } | string }).owner_id?.toString();
  if (ownerId !== currentUserId) {
    const adminPermission = await Permission.exists({ sharedwith: currentUserId, resource_id: fileId, resource_type: "file", permission: "admin" });
    if (!adminPermission) throw new ServiceError("Forbidden", 403);
  }

  const sharedWithUser = sharedWithUserId
    ? await User.findById(sharedWithUserId).lean()
    : await User.findOne({ email: sharedWithEmail?.toLowerCase().trim() }).lean();
  if (!sharedWithUser) throw new ServiceError("User to share with not found", 404);

  const sharedWithId = sharedWithUser._id.toString();
  if (sharedWithId === currentUserId) throw new ServiceError("You cannot share a resource with yourself", 400);

  const perm = await Permission.findOneAndUpdate(
    { sharedwith: sharedWithId, resource_id: fileId, resource_type: "file" },
    { $set: { sharedwith: sharedWithId, resource_id: fileId, resource_type: "file", permission } },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return perm;
}

export async function getFilePermissions(currentUserId: string, fileId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Valid fileId is required", 400);

  await connectDB();

  const resource = await File.findById(fileId).lean();
  if (!resource) throw new ServiceError("Resource not found", 404);

  const ownerId = (resource as { owner_id?: { toString(): string } | string }).owner_id?.toString();
  if (ownerId !== currentUserId) {
    const adminPermission = await Permission.exists({ sharedwith: currentUserId, resource_id: fileId, resource_type: "file", permission: "admin" });
    if (!adminPermission) throw new ServiceError("Forbidden", 403);
  }

  const permissions = await Permission.find({ resource_id: fileId, resource_type: "file" })
    .populate("sharedwith", "name email")
    .sort({ updatedAt: -1 })
    .lean();

  return permissions;
}

export async function revokeFilePermission(currentUserId: string, fileId: string, sharedWithUserId: string) {
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Valid fileId is required", 400);
  if (!ObjectId.isValid(sharedWithUserId)) throw new ServiceError("Valid sharedWithUserId is required", 400);

  await connectDB();

  const resource = await File.findById(fileId).lean();
  if (!resource) throw new ServiceError("Resource not found", 404);

  const ownerId = (resource as { owner_id?: { toString(): string } | string }).owner_id?.toString();
  if (ownerId !== currentUserId) {
    const adminPermission = await Permission.exists({ sharedwith: currentUserId, resource_id: fileId, resource_type: "file", permission: "admin" });
    if (!adminPermission) throw new ServiceError("Forbidden", 403);
  }

  return Permission.deleteOne({ sharedwith: sharedWithUserId, resource_id: fileId, resource_type: "file" });
}
