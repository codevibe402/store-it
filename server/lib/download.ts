import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { generateFileUrl, CDN_CONFIG } from "@/adapters/storage/cdn";
import File from "@/adapters/database/models/File";
import FileVersionModel from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import EncryptionKeyModel from "@/adapters/database/models/EncryptionKey";
import { getFile, getFileDownloadUrl } from "@/adapters/storage/telegram";
import { decryptChunk } from "@/server/services/decryptionService";
import { parseNonce } from "@/server/lib/crypto";
import { computeHash } from "@/server/lib/hash";

const PREFETCH = 4;

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
  encryptionKeyBase64?: string,
): Promise<Response> {
  const chunks = await TelegramChunk.find({ versionId }).sort({ chunkIndex: 1 }).lean();
  const totalChunks = chunks.length;

  if (totalChunks === 0) {
    return new Response("No chunks found for this version", { status: 404 });
  }

  const encryptionKey = encryptionKeyBase64
    ? Buffer.from(encryptionKeyBase64, "base64")
    : null;

  const fetchQueue = new Map<number, Promise<Buffer>>();

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
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      })(),
    );
  }

  for (let i = 0; i < Math.min(PREFETCH, totalChunks); i++) startFetch(i);

  let idx = 0;

  const stream = new ReadableStream({
    async pull(controller: ReadableStreamDefaultController) {
      if (idx >= totalChunks) { controller.close(); return; }
      startFetch(idx + PREFETCH);
      try {
        const data = await fetchQueue.get(idx)!;
        fetchQueue.delete(idx);

        const nonce = chunks[idx].nonce ? parseNonce(chunks[idx].nonce) : null;

        let decrypted: Buffer;
        if (encryptionKey && nonce && nonce.length > 0) {
          decrypted = decryptChunk(data, nonce, encryptionKey);
        } else {
          decrypted = data;
        }

        if (chunks[idx].hash) {
          const computedHash = computeHash(data);
          if (computedHash !== chunks[idx].hash) {
            controller.error(new Error(`Chunk ${idx} integrity check failed`));
            return;
          }
        }

        controller.enqueue(new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength));
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
    ? await FileVersionModel.findById(versionId).lean()
    : file.currentVersionId
      ? await FileVersionModel.findById(file.currentVersionId).lean()
      : null;

  if (!version) return new Response("Version not found", { status: 404 });

  if (version.backend === "telegram") {
    const encryptionKey = await EncryptionKeyModel.findOne({ fileId }).lean();
    return createTelegramDownloadStream(
      version._id.toString(),
      version.size,
      version.mimetype,
      file.filename,
      "attachment",
      encryptionKey?.keyBase64,
    );
  }

  const url = await createS3DownloadUrl(
    version.storageUrl,
    file.filename,
    version.mimetype,
  );
  return Response.redirect(url, 302);
}