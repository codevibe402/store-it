// app/api/folders/[id]/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getAuthUser } from "@/server/auth/auth";
import JSZip from "jszip";
import connectMongoose from "@/adapters/database/mongoose";
import { s3, BUCKET } from "@/adapters/storage/s3";
import Folder from "@/adapters/database/models/Folder";
import File from "@/adapters/database/models/File";

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getUserId(): Promise<string> {
  const user = await getAuthUser();
  if (!user?.userId) {
    const err = new Error("Unauthorised") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user.userId;
}

// ── GET /api/folders/:id/download ─────────────────────────────────────────────
// Fetches every uploaded file in the folder from S3 and streams them back as
// a single ZIP archive. Filename collisions are resolved by appending (1), (2) …
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();

    const { id } = await params;

    

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
    }

    await connectMongoose();

    // ── 1. Verify folder ownership ─────────────────────────────────────────
    const folder = await Folder.findOne({
      _id:      id,
      owner_id: userId,
    }).lean();

    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    // ── 2. Fetch all uploaded file records in folder ───────────────────────
    const files = await File.find({
      folderId: id,
      owner_id: userId,
      status:   "uploaded",
    }).lean();

    if (files.length === 0) {
      return NextResponse.json({ error: "Folder is empty" }, { status: 400 });
    }

    // ── 3. Pull every file from S3 and add to ZIP ─────────────────────────
    const zip       = new JSZip();
    const usedNames = new Map<string, number>();

    await Promise.all(
      files.map(async (file) => {
        try {
          const s3Res = await s3.send(          // ← was s3Client
            new GetObjectCommand({ Bucket: BUCKET, Key: file.storageUrl })
          );

          const chunks: Uint8Array[] = [];
          for await (const chunk of s3Res.Body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          const base  = file.filename as string;
          const count = usedNames.get(base) ?? 0;
          const name  = count === 0 ? base : dedupName(base, count);
          usedNames.set(base, count + 1);

          zip.file(name, buffer);
        } catch (err) {
          console.error(`[ZIP] Failed to fetch S3 key ${file.storageUrl}`, err);
          // Skip missing/inaccessible files rather than aborting the whole ZIP
        }
      })
    );

    // ── 4. Generate ZIP buffer and return ─────────────────────────────────
    const zipBuffer = await zip.generateAsync({
      type:               "nodebuffer",
      compression:        "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const safeFolder = (folder.name as string).replace(/[^a-z0-9_\-. ]/gi, "_");

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type":        "application/zip",
        "Content-Disposition": `attachment; filename="${safeFolder}.zip"`,
        "Content-Length":      String(zipBuffer.byteLength),
        "Cache-Control":       "no-store",
      },
    });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    console.error("[GET /api/folders/:id/download]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function dedupName(original: string, count: number): string {
  const dot = original.lastIndexOf(".");
  if (dot === -1) return `${original} (${count})`;
  return `${original.slice(0, dot)} (${count})${original.slice(dot)}`;
}

