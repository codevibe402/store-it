import { createHash } from "crypto";
import { Readable } from "stream";

export function computeHash(data: Uint8Array | Buffer): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(data));
  return hash.digest("hex");
}

export async function computeHashStream(readable: Readable): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    readable.on("data", (chunk) => hash.update(chunk));
    readable.on("end", () => resolve(hash.digest("hex")));
    readable.on("error", reject);
  });
}

export async function computeHashFromBlob(blob: Blob): Promise<string> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return computeHash(buffer);
}

export function hashToHex(hash: Buffer): string {
  return hash.toString("hex");
}

export function hexToHash(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}