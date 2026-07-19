// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/adapters/storage/telegram", () => ({
  deleteMessage: vi.fn().mockResolvedValue(undefined),
}));

import { getAuthUser } from "@/server/auth/auth";
import { deleteMessage } from "@/adapters/storage/telegram";
import { POST } from "./route";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import EncryptionKey from "@/adapters/database/models/EncryptionKey";

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockDeleteMessage = vi.mocked(deleteMessage);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/x/fallback-to-s3", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({
    email: "alice@example.com",
    name: "Alice",
    provider: "test",
    ...overrides,
  });
}

async function seedTelegramFile(ownerId: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return File.create({
    filename: "video.mp4",
    hash: "hash-1",
    owner_email: "alice@example.com",
    owner_id: ownerId,
    storageUrl: "telegram/some/path",
    backend: "telegram",
    status: "paused",
    totalChunks: 12,
    chunkSize: 4 * 1024 * 1024,
    size: 48 * 1024 * 1024,
    ...overrides,
  });
}

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

afterEach(async () => {
  await clearTestDB();
  vi.clearAllMocks();
});

describe("POST /api/files/[id]/fallback-to-s3", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "000000000000000000000000" }) });
    expect(res.status).toBe(401);
  });

  it("switches backend from telegram to s3 and clears Telegram-only fields", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });

    const file = await seedTelegramFile(user._id);
    await TelegramChunk.create({
      fileId: file._id,
      chunkIndex: 0,
      hash: "h0",
      plaintextHash: "p0",
      size: 1024,
      telegramMessageId: 111,
      telegramFileId: "tg-file-0",
    });

    const res = await POST(makeRequest({ reason: "telegram_failed_after_retries" }), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backend).toBe("s3");
    expect(body.status).toBe("s3_pending");
    expect(typeof body.key).toBe("string");

    expect(mockDeleteMessage).toHaveBeenCalledWith(111);
    expect(await TelegramChunk.countDocuments({ fileId: file._id })).toBe(0);

    const updated = await File.findById(file._id).lean();
    expect(updated?.backend).toBe("s3");
    expect(updated?.status).toBe("s3_pending");
    expect(updated?.encryptionMode).toBe("none");
    expect(updated?.encryptionKey).toBeNull();
    // Regression check for the $set-undefined bug: totalChunks/chunkSize
    // must actually be removed from the document, not just left stale.
    expect(updated).not.toHaveProperty("totalChunks");
    expect(updated).not.toHaveProperty("chunkSize");
  });

  it("deletes the file's EncryptionKey record on fallback", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedTelegramFile(user._id, { encryptionKey: "server-key-base64" });
    await EncryptionKey.create({ fileId: file._id, keyBase64: "server-key-base64" });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(200);
    expect(await EncryptionKey.countDocuments({ fileId: file._id })).toBe(0);
  });

  it("rejects with 409 when the file is not in a fallback-eligible state", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedTelegramFile(user._id, { status: "uploaded" });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(409);
  });

  it("rejects with 409 when the file backend is already s3", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedTelegramFile(user._id, { backend: "s3", status: "s3_pending" });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(409);
  });

  it("rejects with 409 and returns the existing file when a duplicate upload already completed", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedTelegramFile(user._id);
    const existing = await File.create({
      filename: "video.mp4",
      hash: file.hash,
      owner_email: "alice@example.com",
      owner_id: user._id,
      storageUrl: "s3/already/uploaded",
      backend: "s3",
      status: "uploaded",
      size: file.size,
    });

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existingFile._id).toBe(existing._id.toString());
  });

  it("still switches backend and records a cleanup warning when Telegram message deletion fails", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedTelegramFile(user._id);
    await TelegramChunk.create({
      fileId: file._id,
      chunkIndex: 0,
      hash: "h0",
      plaintextHash: "p0",
      size: 1024,
      telegramMessageId: 222,
      telegramFileId: "tg-file-0",
    });
    mockDeleteMessage.mockRejectedValueOnce(new Error("Telegram API down"));

    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cleanupWarnings).toEqual(expect.arrayContaining([expect.stringContaining("222")]));

    const updated = await File.findById(file._id).lean();
    expect(updated?.backend).toBe("s3");
    expect(updated?.cleanupWarnings).toEqual(expect.arrayContaining([expect.stringContaining("222")]));
  });

  it("returns 404 when the authenticated user no longer exists", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "gone", email: "ghost@example.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "000000000000000000000000" }) });
    expect(res.status).toBe(404);
  });
});
