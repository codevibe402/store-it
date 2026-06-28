import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import TelegramChunk from "@/models/TelegramChunk";
import { getFile, getFileDownloadUrl } from "@/lib/telegram";

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
  if (!file) {
    return new Response("File not found", { status: 404 });
  }
  if (file.owner_email !== session.user.email) {
    return new Response("Forbidden", { status: 403 });
  }
  if (file.status !== "uploaded") {
    return new Response("File not fully uploaded yet", { status: 400 });
  }

  const chunks = await TelegramChunk.find({ fileId }).sort({ chunkIndex: 1 }).lean();

  const iterator = chunks[Symbol.iterator]();

  const stream = new ReadableStream({
    async pull(controller) {
      const { value: chunk, done } = iterator.next();
      if (done) {
        controller.close();
        return;
      }

      const { filePath } = await getFile(chunk.telegramFileId);
      const url = getFileDownloadUrl(filePath);
      const res = await fetch(url);
      if (!res.ok) {
        controller.error(new Error(`Failed to download chunk ${chunk.chunkIndex}`));
        return;
      }

      const raw = new Uint8Array(await res.arrayBuffer());

      const actualHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (actualHash !== chunk.hash) {
        controller.error(new Error(`Chunk ${chunk.chunkIndex} hash mismatch`));
        return;
      }

      controller.enqueue(raw);
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
