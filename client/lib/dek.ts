"use client"

import { deriveKey, encryptChunk, decryptChunk, bufferToBase64, base64ToBuffer } from "@/hooks/useFileEncryption"

const DEK_BYTE_LENGTH = 32 // AES-256
const RECOVERY_CODE_ENTROPY_BYTES = 20 // 160 bits
// Crockford base32 alphabet — no I/L/O/U, avoids visual ambiguity when a user
// transcribes the recovery code by hand.
const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function generateDEKBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_BYTE_LENGTH))
}

export async function importDEK(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    bytes.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  )
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_ENTROPY_BYTES))
  let bits = 0
  let value = 0
  let output = ""

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += RECOVERY_ALPHABET[(value << (5 - bits)) & 31]
  }

  return output.match(/.{1,4}/g)!.join("-")
}

// Strip formatting so re-typed/copy-pasted codes with different spacing or
// casing still derive the same key.
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "")
}

export async function deriveWrappingKey(secret: string, saltBase64: string): Promise<CryptoKey> {
  return deriveKey(secret, base64ToBuffer(saltBase64))
}

export async function wrapDEKBytes(
  dekBytes: Uint8Array,
  wrappingKey: CryptoKey,
): Promise<{ ciphertext: string; nonce: string }> {
  const { ciphertext, nonce } = await encryptChunk(dekBytes, wrappingKey)
  return { ciphertext: bufferToBase64(ciphertext), nonce: bufferToBase64(nonce) }
}

export async function unwrapDEKBytes(
  ciphertextBase64: string,
  nonceBase64: string,
  wrappingKey: CryptoKey,
): Promise<Uint8Array> {
  return decryptChunk(base64ToBuffer(ciphertextBase64), wrappingKey, base64ToBuffer(nonceBase64))
}
