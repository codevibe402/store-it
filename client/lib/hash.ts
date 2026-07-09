const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export async function getFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function generateEncryptionKey(): Promise<{ key: string; iv: string }> {
  const keyRaw = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  return {
    key: btoa(String.fromCharCode(...keyRaw)),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

export async function encryptChunk(chunk: Uint8Array, keyBase64: string, nonceBase64: string): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
  const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, ALGORITHM, false, ["encrypt"]);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: nonce },
    cryptoKey,
    Buffer.from(chunk)
  );
  
  return new Uint8Array(encryptedBuffer);
}

export async function decryptChunk(encryptedChunk: Uint8Array, keyBase64: string, nonceBase64: string): Promise<Uint8Array> {
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
  const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, ALGORITHM, false, ["decrypt"]);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: nonce },
    cryptoKey,
    Buffer.from(encryptedChunk)
  );
  
  return new Uint8Array(decryptedBuffer);
}

// Legacy functions - kept for compatibility but deprecated
const LEGACY_ALGORITHM = "AES-GCM";

async function _getKeyFromPassword(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    true,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("storeit-telegram-salt"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: LEGACY_ALGORITHM, length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/** @deprecated Use generateEncryptionKey() instead */
export async function encryptFile(file: File, password: string): Promise<{ encrypted: Blob; iv: string; key: string }> {
  const key = await _getKeyFromPassword(password);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const buffer = await file.arrayBuffer();
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: LEGACY_ALGORITHM, iv },
    key,
    buffer
  );
  const encrypted = new Blob([encryptedBuffer], { type: "application/octet-stream" });
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const keyRaw = await crypto.subtle.exportKey("raw", key);
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
  return { encrypted, iv: ivBase64, key: keyBase64 };
}

/** @deprecated Use decryptChunk() instead */
export async function decryptFile(encryptedBlob: Blob, iv: string, key: string): Promise<Blob> {
  const keyBytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, LEGACY_ALGORITHM, false, ["decrypt"]);
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const buffer = await encryptedBlob.arrayBuffer();
  const decrypted = await crypto.subtle.decrypt({ name: LEGACY_ALGORITHM, iv: ivBytes }, cryptoKey, buffer);
  return new Blob([decrypted], { type: "application/octet-stream" });
}