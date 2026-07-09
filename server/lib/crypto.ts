import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_SIZE = 12;
const AUTH_TAG_SIZE = 16;
const KEY_SIZE = 32;

export interface EncryptionKeyMaterial {
  key: Buffer;
  base64: string;
}

export interface EncryptionContext {
  nonce: Buffer;
  ivBase64: string;
}

export function generateEncryptionKey(): EncryptionKeyMaterial {
  const key = crypto.randomBytes(KEY_SIZE);
  return {
    key,
    base64: key.toString("base64"),
  };
}

export function generateNonce(): EncryptionContext {
  const nonce = crypto.randomBytes(NONCE_SIZE);
  return {
    nonce,
    ivBase64: nonce.toString("base64"),
  };
}

export function parseNonce(nonceBase64: string): Buffer {
  return Buffer.from(nonceBase64, "base64");
}

export function parseKey(keyBase64: string): Buffer {
  return Buffer.from(keyBase64, "base64");
}

export function encryptChunk(plaintext: Buffer, key: Buffer, nonce: Buffer): Buffer {
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, authTag]);
}

export function decryptChunk(encryptedChunk: Buffer, key: Buffer): Buffer {
  if (encryptedChunk.length < NONCE_SIZE + AUTH_TAG_SIZE) {
    throw new Error("Encrypted chunk too short");
  }

  const nonce = encryptedChunk.subarray(0, NONCE_SIZE);
  const authTag = encryptedChunk.subarray(encryptedChunk.length - AUTH_TAG_SIZE);
  const ciphertext = encryptedChunk.subarray(NONCE_SIZE, encryptedChunk.length - AUTH_TAG_SIZE);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function extractNonceFromChunk(encryptedChunk: Buffer): Buffer {
  return encryptedChunk.subarray(0, NONCE_SIZE);
}

export function extractAuthTag(encryptedChunk: Buffer): Buffer {
  return encryptedChunk.subarray(encryptedChunk.length - AUTH_TAG_SIZE);
}

export function getEncryptedChunkSize(plaintextSize: number): number {
  return NONCE_SIZE + plaintextSize + AUTH_TAG_SIZE;
}