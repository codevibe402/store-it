export async function getFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

async function getKeyFromPassword(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode("storeit-telegram-salt"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptFile(file: File, password: string): Promise<{ encrypted: Blob; iv: string; key: string }> {
  const key = await getKeyFromPassword(password);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const buffer = await file.arrayBuffer();
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    buffer
  );
  const encrypted = new Blob([encryptedBuffer], { type: "application/octet-stream" });
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const keyRaw = await crypto.subtle.exportKey("raw", key);
  const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(keyRaw)));
  return { encrypted, iv: ivBase64, key: keyBase64 };
}

export async function decryptFile(encryptedBlob: Blob, iv: string, key: string): Promise<Blob> {
  const keyBytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, ALGORITHM, false, ["decrypt"]);
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const buffer = await encryptedBlob.arrayBuffer();
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv: ivBytes }, cryptoKey, buffer);
  return new Blob([decrypted], { type: "application/octet-stream" });
}
