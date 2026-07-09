import crypto from "crypto";
import { Transform, Readable } from "stream";

const ALGORITHM = "aes-256-gcm";
const NONCE_SIZE = 12;
const AUTH_TAG_SIZE = 16;

export interface EncryptionResult {
  encrypted: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

export function generateKey(): Buffer {
  return crypto.randomBytes(32);
}

export function generateNonce(): Buffer {
  return crypto.randomBytes(NONCE_SIZE);
}

export function encryptChunk(plaintext: Buffer, key: Buffer): EncryptionResult {
  const nonce = generateNonce();
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted, nonce, authTag };
}

export function encryptChunkWithNonce(plaintext: Buffer, nonce: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]);
}

export function decryptChunk(encrypted: Buffer, nonce: Buffer, key: Buffer): Buffer {
  if (encrypted.length < AUTH_TAG_SIZE) {
    throw new Error("Encrypted chunk too short");
  }
  const authTag = encrypted.subarray(encrypted.length - AUTH_TAG_SIZE);
  const ciphertext = encrypted.subarray(0, encrypted.length - AUTH_TAG_SIZE);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function extractNonceFromChunk(encryptedChunk: Buffer): Buffer {
  return encryptedChunk.subarray(0, NONCE_SIZE);
}

export function extractCiphertextAndTag(encryptedChunk: Buffer): { ciphertext: Buffer; authTag: Buffer } {
  const nonce = extractNonceFromChunk(encryptedChunk);
  const remaining = encryptedChunk.subarray(NONCE_SIZE);
  const authTag = remaining.subarray(remaining.length - AUTH_TAG_SIZE);
  const ciphertext = remaining.subarray(0, remaining.length - AUTH_TAG_SIZE);
  return { ciphertext, authTag };
}

export function createChunkEncryptor(key: Buffer, nonce: Buffer): (plaintext: Buffer) => Buffer {
  return (plaintext: Buffer) => encryptChunkWithNonce(plaintext, nonce, key);
}

export function createEncryptionStream(key: Buffer): Transform {
  let currentNonce: Buffer | null = null;
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        if (!currentNonce) {
          currentNonce = generateNonce();
        }
        const result = encryptChunkWithNonce(chunk, currentNonce, key);
        const fullChunk = Buffer.concat([currentNonce, result]);
        this.push(fullChunk);
        currentNonce = null;
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}