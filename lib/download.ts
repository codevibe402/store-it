import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { generateFileUrl, CDN_CONFIG } from "@/lib/cdn";
import File from "@/models/File";
import FileVersion from "@/models/FileVersion";
import TelegramChunk from "@/models/TelegramChunk";
import { getFile, getFileDownloadUrl } from "@/lib/telegram";

const PREFETCH = 4;

async function computeHash(data: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createS3DownloadUrl(
  storageUrl: string,
  filename: string,
  mimetype: string,
  disposition: "inline" | "attachment" = "attachment",
): Promise<string> {
  if (CDN_CONFIG.useCloudFront) {
    return generateFileUrl(storageUrl);
  }
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageUrl,
    ResponseContentDisposition: `${disposition}; filename="${encodeURIComponent(filename)}"`,
    ResponseContentType: mimetype,
  });
  return getSignedUrl(s3, command, { expiresIn: 60 });
}

export async function createS3PresignedUrl(
  storageUrl: string,
  filename: string,
  mimetype: string,
  expiresIn = 60,
  disposition: "inline" | "attachment" = "attachment",
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageUrl,
    ResponseContentDisposition: `${disposition}; filename="${encodeURIComponent(filename)}"`,
    ResponseContentType: mimetype,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function createTelegramDownloadStream(
  versionId: string,
  totalSize: number,
  mimetype: string,
  filename: string,
  disposition: "inline" | "attachment" = "attachment",
): Promise<Response> {
  const chunks = await TelegramChunk.find({ versionId }).sort({ chunkIndex: 1 }).lean();
  const totalChunks = chunks.length;

  if (totalChunks === 0) {
    return new Response("No chunks found for this version", { status: 404 });
  }

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
      "Content-Type": mimetype || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": totalSize.toString(),
    },
  });
}

export async function createVersionDownloadResponse(
  fileId: string,
  versionId?: string,
) {
  const file = await File.findById(fileId).lean();
  if (!file) return new Response("File not found", { status: 404 });

  const version = versionId
    ? await FileVersion.findById(versionId).lean()
    : file.currentVersionId
      ? await FileVersion.findById(file.currentVersionId).lean()
      : null;

  if (!version) return new Response("Version not found", { status: 404 });

  if (version.backend === "telegram") {
    return createTelegramDownloadStream(
      version._id.toString(),
      version.size,
      version.mimetype,
      file.filename,
    );
  }

  const url = await createS3DownloadUrl(
    version.storageUrl,
    file.filename,
    version.mimetype,
  );
  return Response.redirect(url, 302);
}
