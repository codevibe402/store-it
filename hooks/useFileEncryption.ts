"use client"

const PBKDF2_ITERATIONS = 600000
const KEY_LENGTH = 256
const SALT_SIZE = 16
const NONCE_SIZE = 12
const AUTH_TAG_SIZE = 16

let cachedPassphrase: string | null = null

export function setEncryptionPassphrase(p: string) {
  cachedPassphrase = p
}

export function getEncryptionPassphrase(): string | null {
  return cachedPassphrase
}

export function clearEncryptionPassphrase() {
  cachedPassphrase = null
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE))
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase).buffer as ArrayBuffer,
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

export async function encryptFile(
  file: File,
  passphrase: string,
  onProgress?: (pct: number) => void,
): Promise<{
  encryptedChunks: Uint8Array[]
  nonces: string[]
  saltBase64: string
  totalSize: number
}> {
  const salt = generateSalt()
  const key = await deriveKey(passphrase, salt)
  const chunkSize = 4 * 1024 * 1024
  const totalChunks = Math.ceil(file.size / chunkSize)
  const encryptedChunks: Uint8Array[] = []
  const nonces: string[] = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const blob = file.slice(start, end)
    const buffer = new Uint8Array(await blob.arrayBuffer())
    const { ciphertext, nonce } = await encryptChunk(buffer, key)
    encryptedChunks.push(ciphertext)
    nonces.push(bufferToBase64(nonce))
    onProgress?.(Math.round(((i + 1) / totalChunks) * 100))
  }

  return {
    encryptedChunks,
    nonces,
    saltBase64: bufferToBase64(salt),
    totalSize: file.size,
  }
}

export async function decryptFileChunks(
  encryptedChunks: Uint8Array[],
  nonces: string[],
  passphrase: string,
  saltBase64: string,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array[]> {
  const salt = base64ToBuffer(saltBase64)
  const key = await deriveKey(passphrase, salt)
  const decrypted: Uint8Array[] = []

  for (let i = 0; i < encryptedChunks.length; i++) {
    const nonce = base64ToBuffer(nonces[i])
    const plaintext = await decryptChunk(encryptedChunks[i], key, nonce)
    decrypted.push(plaintext)
    onProgress?.(Math.round(((i + 1) / encryptedChunks.length) * 100))
  }

  return decrypted
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i])
  return btoa(binary)
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf
}
