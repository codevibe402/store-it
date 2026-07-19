// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

const deleteMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/adapters/storage/telegram", () => ({
  deleteMessage: (...args: unknown[]) => deleteMessageMock(...args),
}));

import { getAuthUser } from "@/server/auth/auth";
import { POST } from "./route";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/telegram/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

async function seedUser() {
  return User.create({ email: "dismisser@example.com", name: "D", provider: "test" });
}

async function seedPendingFile(ownerEmail: string, ownerId: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return File.create({
    filename: "stalled.bin", hash: "h-" + Math.random().toString(36).slice(2),
    owner_email: ownerEmail, owner_id: ownerId,
    storageUrl: "telegram/stalled.bin", backend: "telegram", status: "paused", size: 10,
    ...overrides,
  });
}

describe("POST /api/files/telegram/cancel", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ fileId: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither fileId nor fileIds is provided", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("cancels a single stalled upload: deletes the File row and its Telegram chunks", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedPendingFile(user.email, user._id);
    await TelegramChunk.create({
      fileId: file._id, chunkIndex: 0, hash: "h", plaintextHash: "h", size: 1,
      telegramMessageId: 42, telegramFileId: "tg-1",
    });

    const res = await POST(makeRequest({ fileId: file._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledCount).toBe(1);

    expect(await File.findById(file._id)).toBeNull();
    expect(await TelegramChunk.countDocuments({ fileId: file._id })).toBe(0);
    expect(deleteMessageMock).toHaveBeenCalledWith(42);
  });

  // Regression test for the safety guard added alongside "dismiss all": a
  // cancel request must never delete a file that already finished
  // uploading, even if a stale client sends its id (e.g. a batch dismiss
  // that raced a just-completed upload).
  it("refuses to cancel (and does not delete) a file that has already finished uploading", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedPendingFile(user.email, user._id, { status: "uploaded" });

    const res = await POST(makeRequest({ fileId: file._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledCount).toBe(0);
    expect(body.results[0].reason).toBe("already_uploaded");

    expect(await File.findById(file._id)).not.toBeNull();
  });

  it("batch-cancels multiple fileIds in one request ('dismiss all')", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const fileA = await seedPendingFile(user.email, user._id);
    const fileB = await seedPendingFile(user.email, user._id);
    const alreadyUploaded = await seedPendingFile(user.email, user._id, { status: "uploaded" });

    const res = await POST(makeRequest({ fileIds: [fileA._id.toString(), fileB._id.toString(), alreadyUploaded._id.toString()] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledCount).toBe(2);

    expect(await File.findById(fileA._id)).toBeNull();
    expect(await File.findById(fileB._id)).toBeNull();
    expect(await File.findById(alreadyUploaded._id)).not.toBeNull();
  });

  it("does not cancel (or leak the existence of) another user's file", async () => {
    const user = await seedUser();
    const stranger = await User.create({ email: "stranger@example.com", name: "S", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const strangerFile = await seedPendingFile(stranger.email, stranger._id);

    const res = await POST(makeRequest({ fileId: strangerFile._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledCount).toBe(0);
    expect(body.results[0].reason).toBe("forbidden");
    expect(await File.findById(strangerFile._id)).not.toBeNull();
  });

  it("ignores a fileId that doesn't exist instead of erroring the whole batch", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await seedPendingFile(user.email, user._id);

    const res = await POST(makeRequest({ fileIds: [file._id.toString(), "000000000000000000000000"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelledCount).toBe(1);
    expect(await File.findById(file._id)).toBeNull();
  });
});
