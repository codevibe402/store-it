import { ObjectId } from "mongodb";
import { createHash } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import Folder from "@/adapters/database/models/Folder";
import User from "@/adapters/database/models/User";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import { ServiceError } from "@/server/services/shareService";
import { resolveShareLinkForFolder } from "@/server/services/permissionService";
import { createS3DownloadUrl } from "@/server/lib/download";
import { extractSearchText } from "@/server/lib/fileText";

// Anonymous, token-authenticated browsing of a shared folder tree. Every
// call re-resolves the link (expiry/revocation/password) and, when a
// specific descendant folder is requested, re-verifies it's actually
// inside the share root via `ancestors` — so a link can never be used to
// reach a folder outside what was shared, and a revoke/expiry takes effect
// on the very next request regardless of how deep the browsing session is.

type LinkOpts = { sessionVerified?: boolean };

export async function browseSharedFolder(token: string, targetFolderId: string | null, password?: string, opts?: LinkOpts) {
  await connectDB();
  const access = await resolveShareLinkForFolder(token, targetFolderId, password, opts);
  if (access.requiresPassword) return { requiresPassword: true as const };

  const folder = await Folder.findOne({ _id: access.folderId, deleted: { $ne: true } }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  const [subfolders, files] = await Promise.all([
    Folder.find({ parent_id: access.folderId, deleted: { $ne: true } }).select("_id name createdAt").sort({ name: 1 }).lean(),
    File.find({ folderId: access.folderId, owner_id: folder.owner_id, status: "uploaded", deleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return {
    requiresPassword: false as const,
    linkRole: access.role,
    expiresAt: access.expiresAt,
    folderId: access.folderId,
    folderName: folder.name,
    canUpload: access.role === "editor",
    canCreateFolder: access.role === "editor",
    subfolders: subfolders.map((f) => ({ id: f._id.toString(), name: f.name })),
    files: files.map((f) => ({
      fileId: f._id.toString(),
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
      backend: f.backend,
      downloadUrl: `/api/shared/${token}/files/${f._id}/download`,
    })),
  };
}

export async function createFolderInSharedFolder(token: string, targetFolderId: string | null, name: string, password?: string, opts?: LinkOpts) {
  if (!name?.trim()) throw new ServiceError("Folder name required", 400);
  await connectDB();

  const access = await resolveShareLinkForFolder(token, targetFolderId, password, opts);
  if (access.requiresPassword) throw new ServiceError("Password required", 401);
  if (access.role !== "editor") throw new ServiceError("This share link is read-only", 403);

  const parent = await Folder.findOne({ _id: access.folderId, deleted: { $ne: true } }).lean();
  if (!parent) throw new ServiceError("Folder not found", 404);
  const owner = await User.findById(parent.owner_id).lean();

  const folder = await Folder.create({
    name: name.trim(),
    owner_id: String(parent.owner_id),
    owner_email: owner?.email ?? parent.owner_email,
    parent_id: access.folderId,
    ancestors: [...parent.ancestors, parent._id],
    depth: parent.depth + 1,
  });

  return folder;
}

export async function uploadToSharedFolder(token: string, targetFolderId: string | null, uploadedFile: File, password?: string, opts?: LinkOpts) {
  await connectDB();

  const access = await resolveShareLinkForFolder(token, targetFolderId, password, opts);
  if (access.requiresPassword) throw new ServiceError("Password required", 401);
  if (access.role !== "editor") throw new ServiceError("This share link is read-only", 403);

  const folder = await Folder.findOne({ _id: access.folderId, deleted: { $ne: true } }).lean();
  if (!folder) throw new ServiceError("Folder not found", 404);

  const user = await User.findById(folder.owner_id);
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
    const existing = await File.findOne({ filename: resolvedFilename, folderId: access.folderId, owner_id: user._id, status: "uploaded" }).lean();
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
    folders_id: access.folderId, folderId: access.folderId,
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

export async function getSharedFileDownload(token: string, fileId: string, password?: string, opts?: LinkOpts) {
  await connectDB();
  if (!ObjectId.isValid(fileId)) throw new ServiceError("Invalid file id", 400);

  const file = await File.findOne({ _id: fileId, status: "uploaded", deleted: { $ne: true } }).lean();
  if (!file) throw new ServiceError("File not found", 404);

  // The share link only ever names its own root folder; a file nested
  // several levels deep is authorized by walking that file's own folder up
  // through `ancestors`, exactly like every other permission check here —
  // never by trusting a client-supplied folder id.
  const targetFolderId = file.folderId ? String(file.folderId) : null;
  const access = await resolveShareLinkForFolder(token, targetFolderId, password, opts);
  if (access.requiresPassword) throw new ServiceError("Password required", 401);

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
