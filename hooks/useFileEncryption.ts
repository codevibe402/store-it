"use client"

const PBKDF2_ITERATIONS = 600000
const KEY_LENGTH = 256
const NONCE_SIZE = 12
const AUTH_TAG_SIZE = 16

// The account's Data Encryption Key (DEK) for the current session — held in
// memory only, never persisted here. Set once per session by AuthProvider
// after it's unwrapped (from the device store or via recovery code).
let cachedDEK: CryptoKey | null = null

export function setSessionDEK(key: CryptoKey) {
  cachedDEK = key
}

export function getSessionDEK(): CryptoKey | null {
  return cachedDEK
}

export function clearSessionDEK() {
  cachedDEK = null
}

export async function deriveKey(
  secret: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret).buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  )
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  )
}

export async function encryptChunk(
  plaintext: Uint8Array,
  key: CryptoKey,
  nonce?: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const iv = nonce || crypto.getRandomValues(new Uint8Array(NONCE_SIZE))
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource, tagLength: AUTH_TAG_SIZE * 8 },
    key,
    plaintext as unknown as BufferSource,
  )
  return { ciphertext: new Uint8Array(encrypted), nonce: iv }
}

export async function decryptChunk(
  ciphertext: Uint8Array,
  key: CryptoKey,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as unknown as BufferSource, tagLength: AUTH_TAG_SIZE * 8 },
    key,
    ciphertext as unknown as BufferSource,
  )
  return new Uint8Array(decrypted)
}

export function bufferToBase64(buf: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i])
  return btoa(binary)
}

export function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf
}
