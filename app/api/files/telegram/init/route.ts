import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import User from "@/adapters/database/models/User";
import { generateEncryptionKey } from "@/server/lib/crypto";
import { resolveFolderPermission, atLeast, canUploadToFile } from "@/server/services/uploadAccess";

const CHUNK_SIZE = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { filename, mimeType, size, hash, folderId = null, fileId, encryptionSalt, useEncryption, useDek } = body as {
    filename: string;
    mimeType: string;
    size: number;
    hash: string;
    folderId: string | null;
    fileId?: string;
    encryptionSalt?: string;
    useEncryption?: boolean;
    useDek?: boolean;
  };

  if (!filename || !size || !hash) {
    return NextResponse.json(
      { error: "filename, size, and hash are required" },
      { status: 400 }
    );
  }

  await connectDB();

  const user = await User.findOne({ email: authUser.email });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let file;

  if (fileId) {
    // Not filtered by owner_id — an editor resuming an upload they
    // started into someone else's shared folder is legitimate. Ownership
    // was already resolved once at the original init call (owner_id below
    // is always the folder/tree owner, not necessarily the uploader);
    // access is re-verified fresh right here regardless of who created it.
    file = await File.findOne({
      _id: fileId,
      status: { $in: ["pending", "uploading", "paused"] },
      backend: "telegram",
    });

    if (!file || !(await canUploadToFile(user._id.toString(), file))) {
      return NextResponse.json(
        { error: "Upload not found or not in valid state" },
        { status: 404 }
      );
    }

    if (file.hash !== hash) {
      return NextResponse.json(
        { error: "File hash mismatch" },
        { status: 409 }
      );
    }
  } else {
    // Resolve who this file actually belongs to: the uploader, unless
    // they're uploading into a folder shared with them, in which case
    // ownership (and the storage quota being spent) follows the folder's
    // owner — same rule server/services/folderService.ts's createFolder
    // and sharedFolderService.ts's uploadToSharedFolder already use, so a
    // shared tree never ends up with mixed ownership depending on which
    // upload path was used.
    let owner = user;
    if (folderId) {
      if (!ObjectId.isValid(folderId)) {
        return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
      }
      const folder = await Folder.findOne({ _id: folderId, deleted: { $ne: true } }).lean();
      if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

      if (String(folder.owner_id) !== user._id.toString()) {
        const access = await resolveFolderPermission(user._id.toString(), folderId);
        if (!access || !atLeast(access.role, "editor")) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const folderOwner = await User.findById(folder.owner_id);
        if (!folderOwner) return NextResponse.json({ error: "Folder owner not found" }, { status: 404 });
        owner = folderOwner;

        // A DEK-encrypted upload is only ever readable by the account
        // whose DEK encrypted it. Uploading into another account's shared
        // folder under that mode would silently hand the owner a file
        // they can never decrypt — reject rather than produce that trap.
        if (useDek) {
          return NextResponse.json(
            { error: "Zero-knowledge (DEK) encryption isn't supported for uploads into a folder shared by another account" },
            { status: 400 }
          );
        }
      }
    }

    if (!owner.hasEnoughStorage(size)) {
      return NextResponse.json({ error: "Storage limit exceeded" }, { status: 413 });
    }

    const existingFile = await File.findOne({
      hash,
      owner_id: owner._id,
      status: "uploaded",
      backend: "telegram",
    });

    if (existingFile) {
      return NextResponse.json(
        { error: "Duplicate file", existingFile },
        { status: 409 }
      );
    }

    const totalChunks = Math.ceil(size / CHUNK_SIZE);

    // Mode 1: Zero-knowledge, account DEK — client encrypts with its DEK,
    // server never sees a key. This is the current default zero-knowledge
    // mode; decrypt-on-download reads file.encryptionMode === 'dek'.
    if (useDek) {
      file = await File.create({
        filename,
        hash,
        size,
        mimetype: mimeType || "application/octet-stream",
        owner_id: owner._id,
        owner_email: owner.email,
        storageUrl: `telegram/${owner._id}/${Date.now()}-${filename}`,
        folderId: folderId ?? null,
        folders_id: folderId ?? null,
        backend: "telegram",
        totalChunks,
        chunkSize: CHUNK_SIZE,
        status: "pending",
        encryptionMode: "dek",
      });
    } else if (encryptionSalt) {
      // Legacy zero-knowledge mode (passphrase-derived, per-file salt).
      // Kept only so old in-flight uploads from before the DEK system don't
      // break; no longer produced by the client. Note: encryptionMode stays
      // 'none' here since these files were never wired up for client-side
      // decrypt — this preserves their pre-existing (already broken)
      // behavior rather than claiming a decrypt path that doesn't exist.
      file = await File.create({
        filename,
        hash,
        size,
        mimetype: mimeType || "application/octet-stream",
        owner_id: owner._id,
        owner_email: owner.email,
        storageUrl: `telegram/${owner._id}/${Date.now()}-${filename}`,
        folderId: folderId ?? null,
        folders_id: folderId ?? null,
        backend: "telegram",
        totalChunks,
        chunkSize: CHUNK_SIZE,
        status: "pending",
        encryptionIv: encryptionSalt,
      });
    } else if (useEncryption) {
      // Mode 2: Server-side encryption (backward compat)
      const { base64: keyBase64 } = generateEncryptionKey();

      file = await File.create({
        filename,
        hash,
        size,
        mimetype: mimeType || "application/octet-stream",
        owner_id: owner._id,
        owner_email: owner.email,
        storageUrl: `telegram/${owner._id}/${Date.now()}-${filename}`,
        folderId: folderId ?? null,
        folders_id: folderId ?? null,
        backend: "telegram",
        totalChunks,
        chunkSize: CHUNK_SIZE,
        status: "pending",
        encryptionKey: keyBase64,
        encryptionMode: "server",
      });

      if (keyBase64) {
        await EncryptionKey.create({
          fileId: file._id,
          keyBase64,
          algorithm: "aes-256-gcm",
        });
      }
    } else {
      // Mode 3: No encryption
      file = await File.create({
        filename,
        hash,
        size,
        mimetype: mimeType || "application/octet-stream",
        owner_id: owner._id,
        owner_email: owner.email,
        storageUrl: `telegram/${owner._id}/${Date.now()}-${filename}`,
        folderId: folderId ?? null,
        folders_id: folderId ?? null,
        backend: "telegram",
        totalChunks,
        chunkSize: CHUNK_SIZE,
        status: "pending",
      });
    }
  }

  const totalChunks = file.totalChunks || Math.ceil(size / CHUNK_SIZE);

  return NextResponse.json({
    fileId: file._id.toString(),
    totalChunks,
    chunkSize: file.chunkSize || CHUNK_SIZE,
  });
}
