import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";
import User from "@/adapters/database/models/User";
import { generateEncryptionKey } from "@/server/lib/crypto";

const CHUNK_SIZE = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authUser = await getAuthUser();
  if (!authUser?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { filename, mimeType, size, hash, folderId = null, fileId, encryptionSalt, useEncryption } = body as {
    filename: string;
    mimeType: string;
    size: number;
    hash: string;
    folderId: string | null;
    fileId?: string;
    encryptionSalt?: string;
    useEncryption?: boolean;
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
    file = await File.findOne({
      _id: fileId,
      owner_id: user._id,
      status: { $in: ["pending", "uploading", "paused"] },
      backend: "telegram",
    });

    if (!file) {
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
    if (!user.hasEnoughStorage(size)) {
      return NextResponse.json({ error: "Storage limit exceeded" }, { status: 413 });
    }

    const existingFile = await File.findOne({
      hash,
      owner_id: user._id,
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

    // Mode 1: Zero-knowledge — client provided salt, no server key
    if (encryptionSalt) {
      file = await File.create({
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
        owner_id: user._id,
        owner_email: user.email,
        storageUrl: `telegram/${user._id}/${Date.now()}-${filename}`,
        folderId: folderId ?? null,
        folders_id: folderId ?? null,
        backend: "telegram",
        totalChunks,
        chunkSize: CHUNK_SIZE,
        status: "pending",
        encryptionKey: keyBase64,
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
    }
  }

  const totalChunks = file.totalChunks || Math.ceil(size / CHUNK_SIZE);

  return NextResponse.json({
    fileId: file._id.toString(),
    totalChunks,
    chunkSize: file.chunkSize || CHUNK_SIZE,
  });
}
