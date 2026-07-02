import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import TelegramChunk from "@/models/TelegramChunk";
import { getFile, getFileDownloadUrl } from "@/lib/telegram";

const PREFETCH = 4;

async function computeHash(data: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId } = await params;
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) return new Response("File not found", { status: 404 });
  if (file.owner_email !== session.user.email) return new Response("Forbidden", { status: 403 });
  if (file.backend !== "telegram") return new Response("File is not stored in Telegram", { status: 409 });
  if (file.status !== "uploaded") return new Response("File not fully uploaded yet", { status: 400 });

  const chunks = await TelegramChunk.find({ fileId }).sort({ chunkIndex: 1 }).lean();
  const totalChunks = chunks.length;

  const fetchQueue = new Map<number, Promise<Uint8Array>>();

  function startFetch(index: number) {
    if (index >= totalChunks || fetchQueue.has(index)) return;
    const chunk = chunks[index];
    fetchQueue.set(
      index,
      (async () => {
        const { filePath } = await getFile(chunk.telegramFileId);
        const url = getFileDownloadUrl(filePath);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to download chunk ${index}`);
        return new Uint8Array(await res.arrayBuffer());
      })(),
    );
  }

  for (let i = 0; i < Math.min(PREFETCH, totalChunks); i++) startFetch(i);

  let idx = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      if (idx >= totalChunks) { controller.close(); return; }

      startFetch(idx + PREFETCH);

      try {
        const data = await fetchQueue.get(idx)!;
        fetchQueue.delete(idx);

        const actualHash = await computeHash(data);
        if (actualHash !== chunks[idx].hash) {
          controller.error(new Error(`Chunk ${idx} hash mismatch`));
          return;
        }

        controller.enqueue(data);
        idx++;
      } catch (err) {
        controller.error(err as Error);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": file.mimetype || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": file.size.toString(),
    },
  });
}
