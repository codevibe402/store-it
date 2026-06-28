import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/[...nextauth]";
import connectDB from "@/lib/mongoose";
import File from "@/models/File";
import TelegramChunk from "@/models/TelegramChunk";
import { sendDocument, deleteMessage } from "@/lib/telegram";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const fileId = form.get("fileId") as string;
  const chunkIndexStr = form.get("chunkIndex") as string;
  const hash = form.get("hash") as string;
  const chunkFile = form.get("chunk") as Blob | null;

  if (!fileId || !chunkIndexStr || !hash || !chunkFile) {
    return NextResponse.json({ error: "fileId, chunkIndex, hash, and chunk are required" }, { status: 400 });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (file.owner_email !== session.user.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const exists = await TelegramChunk.findOne({ fileId, chunkIndex });
  if (exists) {
    return NextResponse.json({ message: "Chunk already uploaded" });
  }

  const filename = `${file.filename}.part${chunkIndex}`;

  let lastError: Error | null = null;
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const { messageId, fileId: tgFileId } = await sendDocument(chunkFile, filename);

      try {
        await TelegramChunk.create({
          fileId,
          chunkIndex,
          hash,
          size: chunkFile.size,
          telegramMessageId: messageId,
          telegramFileId: tgFileId,
        });
      } catch (dbErr: any) {
        if (dbErr?.code === 11000) {
          await deleteMessage(messageId);
          return NextResponse.json({ message: "Chunk already recorded" });
        }
        await deleteMessage(messageId);
        throw dbErr;
      }

      return NextResponse.json({ messageId, fileId: tgFileId });
    } catch (err: any) {
      lastError = err;
      if (err.code === 429) {
        if (attempt < delays.length) {
          await sleep(delays[attempt]);
          continue;
        }
      } else {
        throw err;
      }
    }
  }

  return NextResponse.json(
    { error: `Chunk ${chunkIndex} failed after retries: ${lastError?.message}` },
    { status: 500 },
  );
}
