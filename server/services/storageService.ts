import { sendDocument, getFile, getFileDownloadUrl } from "@/adapters/storage/telegram";
import { s3, BUCKET } from "@/adapters/storage/s3";
import { PutObjectCommand, GetObjectCommand, AbortMultipartUploadCommand, CreateMultipartUploadCommand, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import connectDB from "@/adapters/database/mongoose";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import { createHash } from "crypto";

const CHUNK_SIZE = 4 * 1024 * 1024;

export interface TelegramChunkData {
  chunkIndex: number;
  plaintextHash: string;
  nonceBase64: string;
  size: number;
  hash: string;
}

export interface UploadChunkResult {
  messageId: number;
  telegramFileId: string;
  chunkData: TelegramChunkData;
}

export async function uploadTelegramChunk(
  fileId: string,
  chunkIndex: number,
  encryptedChunk: Buffer,
  plaintextHash: string,
  nonceBase64: string,
  size: number
): Promise<UploadChunkResult> {
  await connectDB();

  const file = await File.findById(fileId);
  if (!file) throw new Error("File not found");

  const hash = createHash("sha256").update(encryptedChunk).digest("hex");

  const filename = `${file.filename}.part${chunkIndex}`;
  
  const blob = new Blob([new Uint8Array(encryptedChunk)], { type: "application/octet-stream" });

  const { messageId, fileId: tgFileId } = await sendDocument(blob, filename);

  const chunk = await TelegramChunk.create({
    fileId,
    chunkIndex,
    hash,
    plaintextHash,
    nonce: nonceBase64,
    size,
    telegramMessageId: messageId,
    telegramFileId: tgFileId,
  });

  return {
    messageId,
    telegramFileId: tgFileId,
    chunkData: {
      chunkIndex,
      plaintextHash,
      nonceBase64,
      size,
      hash,
    },
  };
}

export async function downloadTelegramChunk(
  telegramFileId: string
): Promise<Buffer> {
  const { filePath } = await getFile(telegramFileId);
  const url = getFileDownloadUrl(filePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download chunk: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteTelegramChunk(
  messageId: number
): Promise<void> {
  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHANNEL_ID,
          message_id: messageId,
        }),
      }
    );
  } catch {
    }
}

export async function createS3MultipartUpload(
  key: string,
  mimeType: string
): Promise<string> {
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mimeType,
    })
  );
  return UploadId!;
}

export async function uploadS3Chunk(
  key: string,
  uploadId: string,
  partNumber: number,
  chunk: Buffer
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: chunk,
    ContentLength: chunk.length,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 900 });
  const res = await fetch(url, {
    method: "PUT",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      }
    }),
    headers: { "Content-Type": "application/octet-stream" },
  });

  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);

  const etag = res.headers.get("ETag") || `"${partNumber}-${chunk.length}"`;
  return etag;
}

export async function completeS3MultipartUpload(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[]
): Promise<void> {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

export async function abortS3MultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
    })
  );
}

export async function deleteS3Object(key: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key }));
}

export function getChunkSize(): number {
  return CHUNK_SIZE;
}