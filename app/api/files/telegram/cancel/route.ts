import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/server/auth/auth";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { deleteMessage } from "@/adapters/storage/telegram";

// Accepts either a single `fileId` or a batch `fileIds` (the "dismiss all"
// action in UploadPanel.tsx sends the whole visible pending-uploads list in
// one call instead of firing one request per row).
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const fileIds: unknown[] = Array.isArray(body.fileIds)
    ? body.fileIds
    : body.fileId
      ? [body.fileId]
      : [];
  const ids = fileIds.filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) {
    return NextResponse.json({ error: "fileId or fileIds is required" }, { status: 400 });
  }

  await connectDB();

  const results = await Promise.all(
    ids.map(async (fileId) => {
      const file = await File.findById(fileId);
      if (!file) return { fileId, cancelled: false, reason: "not_found" as const };
      if (file.owner_email !== user.email) return { fileId, cancelled: false, reason: "forbidden" as const };
      // A cancel is for an upload still in flight — never delete a file
      // that already finished uploading just because a stale client sent
      // its id (a batch dismiss racing a just-completed upload is exactly
      // the scenario this guards against).
      if (file.status === "uploaded") return { fileId, cancelled: false, reason: "already_uploaded" as const };

      const chunks = await TelegramChunk.find({ fileId });
      for (const chunk of chunks) {
        try {
          await deleteMessage(chunk.telegramMessageId);
        } catch {
        }
      }

      await TelegramChunk.deleteMany({ fileId });
      await File.findByIdAndDelete(fileId);
      return { fileId, cancelled: true as const };
    })
  );

  return NextResponse.json({
    results,
    cancelledCount: results.filter((r) => r.cancelled).length,
  });
}
