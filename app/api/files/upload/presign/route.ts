import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key, uploadId, partNumbers } = body as {
    key: string;
    uploadId: string;
    partNumbers: number[];
  };

  if (!key || !uploadId || !Array.isArray(partNumbers) || partNumbers.length === 0) {
    return NextResponse.json(
      { error: "key, uploadId, and partNumbers are required" },
      { status: 400 }
    );
  }

  // Generate one presigned URL per part (15 min expiry each)
  const urls = await Promise.all(
    partNumbers.map((partNumber) =>
      getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: 900 }
      )
    )
  );

  return NextResponse.json({ urls }, { status: 200 });
}