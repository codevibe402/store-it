import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import connectDB from "@/adapters/database/mongoose";
import { extractSearchText } from "@/server/lib/fileText";
import { BUCKET, s3 } from "@/adapters/storage/s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import FolderShare from "@/adapters/database/models/Foldershare";
import User from "@/adapters/database/models/User";

type RouteContext = {
  params: Promise<{ token: string }>;
};

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value && "size" in value;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { token } = await params;
  const formData = await req.formData();
  const uploadedFile = formData.get("file");

  if (!isUploadedFile(uploadedFile)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  await connectDB();

  const share = await FolderShare.findOne({
    token,
    permission: "add",
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!share) {
    return NextResponse.json({ error: "This share link cannot add files" }, { status: 403 });
  }

  const user = await User.findById(share.owner_id);
  if (!user) {
    return NextResponse.json({ error: "Owner not found" }, { status: 404 });
  }

  const filename = uploadedFile.name;
  const mimeType = uploadedFile.type || "application/octet-stream";
  const size = uploadedFile.size;
  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");

  if (!user.hasEnoughStorage(size)) {
    return NextResponse.json({ error: "Storage limit exceeded" }, { status: 413 });
  }

  let resolvedFilename = filename;
  let conflict = true;
  for (let attempt = 1; conflict; attempt++) {
    const existing = await File.findOne({
      filename: resolvedFilename,
      folderId: share.folderId,
      owner_id: user._id,
      status: "uploaded",
    }).lean();
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

  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType, ContentLength: size })
  );

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

  return NextResponse.json({ file }, { status: 201 });
}
