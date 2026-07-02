import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import { s3, BUCKET } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import File from "@/models/File";
import FileVersion from "@/models/FileVersion";
import User from "@/models/User";
import { extractSearchText } from "@/lib/fileText";

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
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
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

    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.hasEnoughStorage(size)) {
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
        owner_id: user._id,
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
      : `uploads/${user._id}/${Date.now()}-${filename}`;

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
      owner_id: user._id,
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

      await User.findByIdAndUpdate(user._id, { $inc: { storageused: size - oldSize } });

      return NextResponse.json(
        { file: existingByName, version: nextVersion, versioned: true },
        { status: 201 }
      );
    }

    file = await File.create({
      filename,
      hash,
      owner_email: user.email,
      owner_id: user._id,
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

    await User.findByIdAndUpdate(user._id, { $inc: { storageused: size } });

    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
