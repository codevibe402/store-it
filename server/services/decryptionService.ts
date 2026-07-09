import { Transform, Readable, Duplex } from "stream";
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_SIZE = 16;

export function decryptChunk(encrypted: Buffer, nonce: Buffer, key: Buffer): Buffer {
  if (encrypted.length < AUTH_TAG_SIZE) {
    throw new Error("Encrypted chunk too short for auth tag");
  }
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_SIZE);
  const ciphertext = encrypted.subarray(0, encrypted.length - AUTH_TAG_SIZE);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function createDecryptionStream(key: Buffer, nonce: Buffer): Transform {
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        if (chunk.length < AUTH_TAG_SIZE) {
          callback(new Error("Chunk too short for auth tag"));
          return;
        }
        const authTag = chunk.subarray(chunk.length - AUTH_TAG_SIZE);
        const ciphertext = chunk.subarray(0, chunk.length - AUTH_TAG_SIZE);
        const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        this.push(decrypted);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}

export class DecryptingDuplex extends Duplex {
  private key: Buffer;
  private inputNonce: Buffer | null = null;
  private pendingBuffers: Buffer[] = [];

  constructor(key: Buffer) {
    super({ objectMode: true });
    this.key = key;
  }

  _read(size: number): void {
    this.processPending();
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      if (chunk.length < AUTH_TAG_SIZE) {
        callback(new Error("Chunk too short for auth tag"));
        return;
      }
      const authTag = chunk.subarray(chunk.length - AUTH_TAG_SIZE);
      const ciphertext = chunk.subarray(0, chunk.length - AUTH_TAG_SIZE);
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, this.inputNonce as Buffer);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      this.push(decrypted);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  _final(callback: (error?: Error | null) => void): void {
    callback();
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    callback(error);
  }

  setNonce(nonce: Buffer): void {
    this.inputNonce = nonce;
  }

  private processPending(): void {
    while (this.pendingBuffers.length > 0) {
      const buffer = this.pendingBuffers.shift();
      if (buffer && this.inputNonce) {
        try {
          if (buffer.length < AUTH_TAG_SIZE) {
            this.emit("error", new Error("Chunk too short for auth tag"));
            continue;
          }
          const authTag = buffer.subarray(buffer.length - AUTH_TAG_SIZE);
          const ciphertext = buffer.subarray(0, buffer.length - AUTH_TAG_SIZE);
          const decipher = crypto.createDecipheriv(ALGORITHM, this.key, this.inputNonce);
          decipher.setAuthTag(authTag);
          const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          this.push(decrypted);
        } catch (err) {
          this.emit("error", err as Error);
        }
      }
    }
  }
}