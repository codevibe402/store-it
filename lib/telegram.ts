const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID!;
const API_URL = (process.env.TELEGRAM_BOT_API_URL || "https://api.telegram.org").replace(/\/+$/, "");

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

export async function getFile(fileId: string): Promise<{ filePath: string; fileSize: number }> {
  const res = await fetch(botUrl("getFile") + `?file_id=${encodeURIComponent(fileId)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.description || "Telegram getFile failed");
  return {
    filePath: body.result.file_path,
    fileSize: body.result.file_size,
  };
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
