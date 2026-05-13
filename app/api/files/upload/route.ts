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

const MAX_SIZE = 10 * 1024 * 1024;

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

    if (size > MAX_SIZE) {
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

    const existing = await File.findOne({
      hash,
      owner_id: user._id,
      status: "uploaded",
    });

    if (existing) {
      return NextResponse.json(
        { error: "Duplicate file", existingFile: existing },
        { status: 409 }
      );
    }

    const key = `uploads/${user._id}/${Date.now()}-${filename}`;

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

    const previousVersion = await File.findOne({
      filename,
      owner_id: user._id,
      folderId: normalizedFolderId,
      status: "uploaded",
      hash: { $ne: hash },
    });

    if (previousVersion) {
      const latestVersion = await FileVersion.findOne({ file_id: previousVersion._id })
        .sort({ version: -1 })
        .lean();
      const nextVersion = (latestVersion?.version ?? 1) + 1;

      await FileVersion.create({
        file_id: previousVersion._id,
        version: nextVersion,
        storage_url: key,
      });

      const oldSize = previousVersion.size ?? 0;
      previousVersion.hash = hash;
      previousVersion.mimetype = mimeType;
      previousVersion.size = size;
      previousVersion.storageUrl = key;
      previousVersion.searchText = searchText;
      previousVersion.textIndexedAt = searchText ? new Date() : null;
      await previousVersion.save();

      await User.findByIdAndUpdate(user._id, { $inc: { storageused: size - oldSize } });

      return NextResponse.json(
        { file: previousVersion, version: nextVersion, versioned: true },
        { status: 201 }
      );
    }

    const file = await File.create({
      filename,
      hash,
      owner_email: user.email,
      owner_id: user._id,
      mimetype: mimeType,
      size,
      searchText,
      textIndexedAt: searchText ? new Date() : null,
      storageUrl: key,
      folders_id: normalizedFolderId,
      folderId: normalizedFolderId,
      status: "uploaded",
    });

    await FileVersion.create({
      file_id: file._id,
      version: 1,
      storage_url: key,
    });

    await User.findByIdAndUpdate(user._id, { $inc: { storageused: size } });

    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
