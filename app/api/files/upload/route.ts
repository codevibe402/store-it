import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import Folder from "@/adapters/database/models/Folder";
import User from "@/adapters/database/models/User";
import { extractSearchText } from "@/server/lib/fileText";
import { resolveFolderPermission, atLeast } from "@/server/services/permissionService";

const SMALL_FILE_LIMIT = 10 * 1024 * 1024;

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser();
    if (!authUser?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const uploadedFile = formData.get("file");
    const hash = formData.get("hash");
    const folderId = formData.get("folderId");
    const fileId = formData.get("fileId") as string | null;

    if (!isUploadedFile(uploadedFile) || typeof hash !== "string") {
      return NextResponse.json(
        { error: "file and hash are required" },
        { status: 400 }
      );
    }

    const filename = uploadedFile.name;
    const mimeType = uploadedFile.type || "application/octet-stream";
    const size = uploadedFile.size;
    const normalizedFolderId =
      typeof folderId === "string" && folderId.trim() ? folderId : null;

    if (!filename || !size) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (size > SMALL_FILE_LIMIT) {
      return NextResponse.json(
        { error: "File too large" },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findOne({ email: authUser.email });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Ownership (and the storage quota being spent) follows the folder's
    // owner when uploading into a folder shared with this user — same rule
    // server/services/folderService.ts and the telegram/init route already
    // use, so a shared tree never ends up with mixed ownership depending on
    // which upload path was used. Also the only place this route verifies
    // the uploader actually has editor+ access to the target folder at all.
    let owner = user;
    if (normalizedFolderId) {
      if (!ObjectId.isValid(normalizedFolderId)) {
        return NextResponse.json({ error: "Invalid folderId" }, { status: 400 });
      }
      const folder = await Folder.findOne({ _id: normalizedFolderId, deleted: { $ne: true } }).lean();
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      if (String(folder.owner_id) !== user._id.toString()) {
        const access = await resolveFolderPermission(user._id.toString(), normalizedFolderId);
        if (!access || !atLeast(access.role, "editor")) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const folderOwner = await User.findById(folder.owner_id);
        if (!folderOwner) {
          return NextResponse.json({ error: "Folder owner not found" }, { status: 404 });
        }
        owner = folderOwner;
      }
    }

    if (!owner.hasEnoughStorage(size)) {
      return NextResponse.json(
        { error: "Storage limit exceeded" },
        { status: 413 }
      );
    }

    let existingFileRecord = null;

    if (fileId) {
      existingFileRecord = await File.findOne({
        _id: fileId,
        owner_id: user._id,
        status: "s3_pending",
        backend: "s3",
      });
      if (!existingFileRecord) {
        return NextResponse.json(
          { error: "Fallback file not found or not in s3_pending state" },
          { status: 404 },
        );
      }
      if (existingFileRecord.hash !== hash) {
        return NextResponse.json(
          { error: "Selected file does not match the original. Hash mismatch." },
          { status: 409 },
        );
      }
      if (size > SMALL_FILE_LIMIT) {
        return NextResponse.json(
          { error: "File too large for small upload" },
          { status: 400 },
        );
      }
    } else {
      existingFileRecord = await File.findOne({
        hash,
        owner_id: owner._id,
        status: "uploaded",
      });

      if (existingFileRecord) {
        return NextResponse.json(
          { error: "Duplicate file", existingFile: existingFileRecord },
          { status: 409 }
        );
      }
    }

    const key = existingFileRecord
      ? existingFileRecord.storageUrl
      : `uploads/${owner._id}/${Date.now()}-${filename}`;

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const searchText = await extractSearchText(buffer, filename, mimeType);

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ContentLength: size,
      })
    );

    let file;
    if (existingFileRecord) {
      file = existingFileRecord;
      file.status = "uploaded";
      file.searchText = searchText;
      file.textIndexedAt = searchText ? new Date() : null;
      await file.save();

      await User.findByIdAndUpdate(user._id, { $inc: { storageused: size } });
      return NextResponse.json({ file }, { status: 201 });
    }

    const existingByName = await File.findOne({
      filename,
      owner_id: owner._id,
      folderId: normalizedFolderId,
      status: "uploaded",
      hash: { $ne: hash },
    });

    if (existingByName) {
      const latestVersion = await FileVersion.findOne({ file_id: existingByName._id })
        .sort({ version: -1 })
        .lean();
      const nextVersion = (latestVersion?.version ?? 1) + 1;

      const version = await FileVersion.create({
        file_id: existingByName._id,
        version: nextVersion,
        backend: "s3",
        storageUrl: key,
        hash,
        size,
        mimetype: mimeType,
        createdBy: user._id,
      });

      const oldSize = existingByName.size ?? 0;
      existingByName.hash = hash;
      existingByName.mimetype = mimeType;
      existingByName.size = size;
      existingByName.storageUrl = key;
      existingByName.backend = "s3";
      existingByName.searchText = searchText;
      existingByName.textIndexedAt = searchText ? new Date() : null;
      existingByName.currentVersionId = version._id;
      await existingByName.save();

      await User.findByIdAndUpdate(owner._id, { $inc: { storageused: size - oldSize } });

      return NextResponse.json(
        { file: existingByName, version: nextVersion, versioned: true },
        { status: 201 }
      );
    }

    file = await File.create({
      filename,
      hash,
      owner_email: owner.email,
      owner_id: owner._id,
      mimetype: mimeType,
      size,
      searchText,
      textIndexedAt: searchText ? new Date() : null,
      storageUrl: key,
      backend: "s3",
      folders_id: normalizedFolderId,
      folderId: normalizedFolderId,
      status: "uploaded",
    });

    const version = await FileVersion.create({
      file_id: file._id,
      version: 1,
      backend: "s3",
      storageUrl: key,
      hash,
      size,
      mimetype: mimeType,
      createdBy: user._id,
    });

    file.currentVersionId = version._id;
    await file.save();

    await User.findByIdAndUpdate(owner._id, { $inc: { storageused: size } });

    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
