import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import User from "@/adapters/database/models/User";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key, uploadId, parts, fileId } = body as {
    key: string;
    uploadId: string;
    parts: { PartNumber: number; ETag: string }[];
    fileId: string;
  };

  if (!key || !uploadId || !Array.isArray(parts) || !fileId) {
    return NextResponse.json(
      { error: "key, uploadId, parts, and fileId are required" },
      { status: 400 }
    );
  }

  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
      },
    })
  );

  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File record not found" }, { status: 404 });
  }

  if (file.status !== "uploaded") {
    const existingByName = file.status === "pending"
      ? await File.findOne({
          filename: file.filename,
          owner_id: file.owner_id,
          folderId: file.folderId,
          status: "uploaded",
          hash: { $ne: file.hash },
          _id: { $ne: file._id },
        })
      : null;

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
        hash: file.hash,
        size: file.size,
        mimetype: file.mimetype,
        createdBy: file.owner_id,
      });

      const oldSize = existingByName.size ?? 0;
      existingByName.hash = file.hash;
      existingByName.mimetype = file.mimetype;
      existingByName.size = file.size;
      existingByName.storageUrl = key;
      existingByName.searchText = file.searchText;
      existingByName.currentVersionId = version._id;
      await existingByName.save();

      await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size - oldSize } });

      await File.deleteOne({ _id: file._id });

      return NextResponse.json({ file: existingByName, version: nextVersion, versioned: true }, { status: 200 });
    }

    file.status = "uploaded";
    await file.save();

    const version = await FileVersion.create({
      file_id: file._id,
      version: 1,
      backend: "s3",
      storageUrl: key,
      hash: file.hash,
      size: file.size,
      mimetype: file.mimetype,
      createdBy: file.owner_id,
    });

    file.currentVersionId = version._id;
    await file.save();

    await User.findByIdAndUpdate(file.owner_id, { $inc: { storageused: file.size } });
  }

  return NextResponse.json({ file }, { status: 200 });
}
