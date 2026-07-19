// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

const sendDocumentMock = vi.fn();
const deleteMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/adapters/storage/telegram", () => ({
  sendDocument: (...args: unknown[]) => sendDocumentMock(...args),
  deleteMessage: (...args: unknown[]) => deleteMessageMock(...args),
}));

import { getAuthUser } from "@/server/auth/auth";
import { POST } from "./route";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeRequest(fields: Record<string, string>, chunkBytes = [1, 2, 3, 4]) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("chunk", new Blob([new Uint8Array(chunkBytes)]), "chunk.bin");
  return new NextRequest("http://localhost/api/files/telegram/chunk", { method: "POST", body: form });
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

async function seedUserAndTelegramFile(fileOverrides: Partial<Record<string, unknown>> = {}) {
  const user = await User.create({ email: "dave@example.com", name: "Dave", provider: "test" });
  mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
  const file = await File.create({
    filename: "clip.mp4", hash: "hash-1", owner_email: user.email, owner_id: user._id,
    storageUrl: "telegram/dave/clip.mp4", backend: "telegram", status: "pending",
    totalChunks: 2, chunkSize: 4, size: 8,
    ...fileOverrides,
  });
  return { user, file };
}

describe("POST /api/files/telegram/chunk", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ fileId: "x", chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({ fileId: "x", chunkIndex: "0" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a negative/non-numeric chunkIndex", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({ fileId: "x", chunkIndex: "-1", hash: "h" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the file does not exist", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({ fileId: "000000000000000000000000", chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when the requester is not the owner and there's no folder grant", async () => {
    const { file } = await seedUserAndTelegramFile();
    const stranger = await User.create({ email: "eve@example.com", name: "Eve", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: stranger._id.toString(), email: stranger.email, provider: "test", storageused: 0, storagelimit: 1 });

    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(403);
  });

  // Regression test: this branch used to omit the `{ status: 409 }` second
  // argument to NextResponse.json, so it actually responded HTTP 200. The
  // client's `!chunkRes.ok` check then silently treated a rejected chunk as
  // a successfully uploaded one. See useUpload.ts's resumeSingleUpload,
  // which can reach this exact path with stale Telegram uploadMeta after a
  // file's backend has already been switched to s3.
  it("returns 409 (not 200) when the file's backend is no longer telegram", async () => {
    const { file } = await seedUserAndTelegramFile({ backend: "s3", status: "s3_pending" });
    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not using Telegram backend/i);
  });

  it("returns 409 (not 200) when the file is in a non-uploadable status", async () => {
    const { file } = await seedUserAndTelegramFile({ status: "uploaded" });
    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(409);
  });

  it("stores a new chunk, flips a pending file to uploading, and returns 200", async () => {
    const { file } = await seedUserAndTelegramFile();
    sendDocumentMock.mockResolvedValue({ messageId: 555, fileId: "tg-abc" });

    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "plaintext-hash" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chunkIndex).toBe(0);

    const chunk = await TelegramChunk.findOne({ fileId: file._id, chunkIndex: 0 }).lean();
    expect(chunk?.telegramMessageId).toBe(555);
    expect(chunk?.plaintextHash).toBe("plaintext-hash");

    const updatedFile = await File.findById(file._id).lean();
    expect(updatedFile?.status).toBe("uploading");
  });

  it("short-circuits with the existing record when the chunk was already uploaded", async () => {
    const { file } = await seedUserAndTelegramFile({ status: "uploading" });
    await TelegramChunk.create({
      fileId: file._id, chunkIndex: 0, hash: "h", plaintextHash: "h", size: 4,
      telegramMessageId: 1, telegramFileId: "tg-existing",
    });

    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/already uploaded/i);
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  it("signals canFallbackToS3 with a 503 (not 200) when Telegram permanently rejects the upload", async () => {
    const { file } = await seedUserAndTelegramFile();
    const err = Object.assign(new Error("bad request"), { code: 400 });
    sendDocumentMock.mockRejectedValue(err);

    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "h" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.canFallbackToS3).toBe(true);
    // Non-429 errors aren't retried — MAX_RETRIES only bounds the
    // rate-limit backoff loop, not general failures.
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 rate-limit responses before eventually succeeding", async () => {
    // Real timers on purpose: faking global timers here fights with
    // mongodb-memory-server's/mongoose's own internal timer usage and hangs
    // the test. The route's backoff is only 1s on the first retry, so
    // eating the real delay is cheap and avoids that flakiness.
    const { file } = await seedUserAndTelegramFile();
    const rateLimited = Object.assign(new Error("rate limited"), { code: 429 });
    sendDocumentMock
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ messageId: 999, fileId: "tg-retry" });

    const res = await POST(makeRequest({ fileId: file._id.toString(), chunkIndex: "0", hash: "h" }));

    expect(res.status).toBe(200);
    expect(sendDocumentMock).toHaveBeenCalledTimes(2);
  }, 10000);
});
