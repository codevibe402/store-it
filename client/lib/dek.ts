"use client"

import { deriveKey, encryptChunk, decryptChunk, bufferToBase64, base64ToBuffer, setSessionDEK } from "@/hooks/useFileEncryption"
import { storeDeviceDEK } from "@/client/lib/dekStore"

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

// Shared by every place that turns a recovery code + this account's wrapped
// DEK into a usable, device-local key: derive the wrapping key, unwrap,
// persist it for this device (IndexedDB, see dekStore.ts), and make it the
// active session key. Throws (AES-GCM auth-tag failure) if the code doesn't
// match this account's wrap — that failure is the only signal callers get,
// by design, since the server never verifies the code against the wrap.
export async function unlockDeviceDEK(
  userId: string,
  recoveryCode: string,
  wrapped: { recoveryWrapped: string; recoveryNonce: string; recoverySalt: string },
): Promise<void> {
  const wrappingKey = await deriveWrappingKey(normalizeRecoveryCode(recoveryCode), wrapped.recoverySalt)
  const dekBytes = await unwrapDEKBytes(wrapped.recoveryWrapped, wrapped.recoveryNonce, wrappingKey)
  await storeDeviceDEK(userId, bufferToBase64(dekBytes))
  setSessionDEK(await importDEK(dekBytes))
}
