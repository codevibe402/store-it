import { NextRequest, NextResponse, after } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import { getFileChunkData } from "@/server/services/fileService";
import { ServiceError } from "@/server/services/shareService";
import { getFile, getFileDownloadUrl } from "@/adapters/storage/telegram";
import { getCachedChunk, cacheChunkBestEffort } from "@/server/lib/telegramChunkCache";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  try {
    const user = await getAuthUser();
    if (!user?.userId) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

    const { id, index } = await params;
    const versionId = req.nextUrl.searchParams.get("versionId");
    const chunkIndex = parseInt(index, 10);
    if (!versionId || isNaN(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json({ error: "versionId and a valid chunk index are required" }, { status: 400 });
    }

    const chunk = await getFileChunkData(user.userId, id, versionId, chunkIndex);

    const cached = await getCachedChunk(versionId, chunkIndex);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(chunk.size),
          "Cache-Control": "private, max-age=86400, immutable",
        },
      });
    }

    const { filePath } = await getFile(chunk.telegramFileId);
    const tgRes = await fetch(getFileDownloadUrl(filePath));
    if (!tgRes.ok || !tgRes.body) {
      return NextResponse.json({ error: "Failed to fetch chunk from storage" }, { status: 502 });
    }

    const data = Buffer.from(await tgRes.arrayBuffer());
    after(() => cacheChunkBestEffort(versionId, chunkIndex, data));

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.size),
        // Ciphertext for a given (versionId, chunkIndex) is immutable.
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GET /api/files/:id/chunk-data/:index]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
