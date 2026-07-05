import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BUCKET, s3 } from "@/adapters/storage/s3";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key, uploadId, partNumbers } = (await req.json()) as {
    key?: string;
    uploadId?: string;
    partNumbers?: number[];
  };

  if (!key || !uploadId || !Array.isArray(partNumbers) || partNumbers.length === 0) {
    return NextResponse.json(
      { error: "key, uploadId, and partNumbers are required" },
      { status: 400 }
    );
  }

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
        { expiresIn: 60 * 30 }
      )
    )
  );

  return NextResponse.json({ urls });
}
