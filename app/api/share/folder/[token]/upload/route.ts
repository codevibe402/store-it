import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import connectDB from "@/lib/mongoose";
import { extractSearchText } from "@/lib/fileText";
import { BUCKET, s3 } from "@/lib/s3";
import File from "@/models/File";
import FileVersion from "@/models/FileVersion";
import FolderShare from "@/models/Foldershare";
import User from "@/models/User";

type RouteContext = {
  params: Promise<{ token: string }>;
};

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
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

  const duplicate = await File.findOne({
    hash,
    owner_id: user._id,
    status: "uploaded",
  }).lean();

  if (duplicate) {
    return NextResponse.json(
      { error: "Duplicate file", existingFile: duplicate },
      { status: 409 }
    );
  }

  const key = `uploads/${user._id}/${Date.now()}-${filename}`;
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
    folders_id: share.folderId,
    folderId: share.folderId,
    status: "uploaded",
  });

  await FileVersion.create({
    file_id: file._id,
    version: 1,
    storage_url: key,
  });

  await User.findByIdAndUpdate(user._id, { $inc: { storageused: size } });

  return NextResponse.json({ file }, { status: 201 });
}
