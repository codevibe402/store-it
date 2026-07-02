import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import connectMongoose from "@/lib/mongoose";
import { authOptions } from "@/lib/[...nextauth]";
import File from "@/models/File";
import FileVersion from "@/models/FileVersion";
import { createS3DownloadUrl, createTelegramDownloadStream } from "@/lib/download";

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return session.user.id;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
    }

    await connectMongoose();

    const file = await File.findOne({
      _id: id,
      owner_id: userId,
      status: "uploaded",
    }).lean();

    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const versionId = req.nextUrl.searchParams.get("versionId");
    const preview = req.nextUrl.searchParams.get("preview") === "1";
    let version;

    if (versionId) {
      version = await FileVersion.findById(versionId).lean();
    } else if (file.currentVersionId) {
      version = await FileVersion.findById(file.currentVersionId).lean();
    }

    if (version?.backend === "telegram") {
      return createTelegramDownloadStream(
        version._id.toString(),
        version.size,
        preview ? file.mimetype : version.mimetype,
        file.filename,
        preview ? "inline" : "attachment",
      );
    }

    const storageUrl = version?.storageUrl ?? file.storageUrl;
    const disposition = preview ? "inline" : "attachment";
    const downloadUrl = await createS3DownloadUrl(
      storageUrl,
      file.filename,
      file.mimetype,
      disposition,
    );

    const response = NextResponse.redirect(downloadUrl, { status: 302 });
    response.headers.set('Cache-Control', 'public, max-age=86400');
    return response;
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[GET /api/files/:id/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

