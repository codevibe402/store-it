const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID!;
const API_URL = (process.env.TELEGRAM_BOT_API_URL || "https://api.telegram.org").replace(/\/+$/, "");

// Node 18+ fetch uses undici internally with keep-alive connection pooling by default.
// No explicit configuration needed — connections to the same origin are reused automatically.

function botUrl(method: string) {
  return `${API_URL}/bot${BOT_TOKEN}/${method}`;
}

export async function sendDocument(
  blob: Blob,
  filename: string,
): Promise<{ messageId: number; fileId: string }> {
  const form = new FormData();
  form.append("chat_id", CHANNEL_ID);
  form.append("document", blob, filename);

  const res = await fetch(botUrl("sendDocument"), { method: "POST", body: form });
  const body = await res.json();

  if (!res.ok) {
    const err = new Error(body.description || "Telegram upload failed") as Error & { code?: number };
    err.code = res.status;
    throw err;
  }

  const msg = body.result;
  return {
    messageId: msg.message_id,
    fileId: msg.document.file_id,
  };
}

// Telegram guarantees a getFile download link stays valid for at least an
// hour — caching the resolved file_path for less than that (per serverless
// instance; this is memory-only and doesn't survive cold starts, but a warm
// instance handling a burst of chunk requests for the same file — the
// common case when previewing/scrubbing — skips a full API round trip per
// chunk instead of just one) cuts one of the two network hops per chunk
// fetch without touching correctness.
const FILE_PATH_TTL_MS = 50 * 60 * 1000;
const filePathCache = new Map<string, { filePath: string; fileSize: number; expiresAt: number }>();

export async function getFile(fileId: string): Promise<{ filePath: string; fileSize: number }> {
  const cached = filePathCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    return { filePath: cached.filePath, fileSize: cached.fileSize };
  }

  const res = await fetch(botUrl("getFile") + `?file_id=${encodeURIComponent(fileId)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.description || "Telegram getFile failed");

  const result = { filePath: body.result.file_path, fileSize: body.result.file_size };
  filePathCache.set(fileId, { ...result, expiresAt: Date.now() + FILE_PATH_TTL_MS });
  return result;
}

export function getFileDownloadUrl(filePath: string): string {
  return `${API_URL}/file/bot${BOT_TOKEN}/${filePath}`;
}

export async function deleteMessage(messageId: number): Promise<void> {
  const res = await fetch(botUrl("deleteMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHANNEL_ID, message_id: messageId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.warn("Failed to delete Telegram message", messageId, body);
  }
}

export function validateConfig(): string | null {
  if (!BOT_TOKEN) return "TELEGRAM_BOT_TOKEN is not set";
  if (!CHANNEL_ID) return "TELEGRAM_CHANNEL_ID is not set";
  return null;
}
