// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

import { getAuthUser } from "@/server/auth/auth";
import { POST } from "./route";
import { deleteFile, hardDeleteFile } from "@/server/services/fileService";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";

const mockGetAuthUser = vi.mocked(getAuthUser);

vi.mock("@/adapters/storage/telegram", () => ({
  deleteMessage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/adapters/storage/s3", () => ({
  s3: { send: vi.fn() },
  BUCKET: "test-bucket",
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/telegram/complete", {
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
  return User.create({ email: "complete@example.com", name: "C", provider: "test", storageused: 0 });
}

async function seedPlaceholder(owner: InstanceType<typeof User>, overrides: Partial<Record<string, unknown>> = {}) {
  return File.create({
    filename: "movie.mkv", hash: "hash-new", owner_email: owner.email, owner_id: owner._id,
    storageUrl: "telegram/owner/movie.mkv", backend: "telegram", status: "uploading",
    totalChunks: 1, chunkSize: 4, size: 400, ...overrides,
  });
}

async function addChunk(fileId: mongoose.Types.ObjectId | string, messageId: number) {
  return TelegramChunk.create({
    fileId, chunkIndex: 0, hash: "h", plaintextHash: "h", size: 400,
    telegramMessageId: messageId, telegramFileId: `tg-${messageId}`,
  });
}

describe("POST /api/files/telegram/complete", () => {
  it("finalizes as version 1 when there is no same-name conflict", async () => {
    const owner = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const placeholder = await seedPlaceholder(owner);
    await addChunk(placeholder._id, 1);

    const res = await POST(makeRequest({ fileId: placeholder._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versioned).toBe(false);
    expect(body.version).toBe(1);

    const file = await File.findById(placeholder._id).lean();
    expect(file?.status).toBe("uploaded");
    expect(file?.currentVersionId?.toString()).toBe(body.versionId);

    const chunk = await TelegramChunk.findOne({ fileId: placeholder._id }).lean();
    expect(chunk?.versionId?.toString()).toBe(body.versionId);
  });

  it("returns alreadyUploaded without creating a duplicate version on a repeat call", async () => {
    const owner = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const placeholder = await seedPlaceholder(owner, { status: "uploaded" });
    await addChunk(placeholder._id, 99);
    await FileVersion.create({
      file_id: placeholder._id, version: 1, backend: "telegram", storageUrl: placeholder.storageUrl,
      hash: placeholder.hash, size: placeholder.size, mimetype: "video/x-matroska", createdBy: owner._id,
    });

    const res = await POST(makeRequest({ fileId: placeholder._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyUploaded).toBe(true);
    expect(await FileVersion.countDocuments({ file_id: placeholder._id })).toBe(1);
  });

  it("merges into an existing same-name file as a new version instead of leaving two File documents (the gap this route used to have)", async () => {
    const owner = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });

    const existing = await File.create({
      filename: "movie.mkv", hash: "hash-old", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "s3/owner/movie-v1.mkv", backend: "s3", status: "uploaded", size: 100,
    });
    await FileVersion.create({
      file_id: existing._id, version: 1, backend: "s3", storageUrl: existing.storageUrl,
      hash: existing.hash, size: existing.size, mimetype: "video/x-matroska", createdBy: owner._id,
    });

    const placeholder = await seedPlaceholder(owner);
    await addChunk(placeholder._id, 2);

    const res = await POST(makeRequest({ fileId: placeholder._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versioned).toBe(true);
    expect(body.version).toBe(2);
    expect(body.file._id).toBe(existing._id.toString());

    // Exactly one File document survives — this is the actual gap being closed.
    expect(await File.countDocuments({ filename: "movie.mkv", owner_id: owner._id })).toBe(1);
    expect(await File.findById(placeholder._id)).toBeNull();

    const updated = await File.findById(existing._id).lean();
    expect(updated?.backend).toBe("telegram");
    expect(updated?.hash).toBe("hash-new");

    // The merged-in chunk must be findable by the surviving file's id, or a
    // later recycle-bin hard-delete would orphan it. Prove it end to end
    // through the real recycle-bin flow (soft-delete, then hard-delete).
    const chunk = await TelegramChunk.findOne({ telegramMessageId: 2 }).lean();
    expect(chunk?.fileId.toString()).toBe(existing._id.toString());

    await deleteFile(owner._id.toString(), existing._id.toString());
    await hardDeleteFile(owner._id.toString(), existing._id.toString());

    expect(await File.findById(existing._id)).toBeNull();
    expect(await TelegramChunk.countDocuments({ fileId: existing._id })).toBe(0);
  });

  it("does not merge (falls back to a separate File) when both the existing file and the new upload independently used server-side encryption", async () => {
    const owner = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });

    const existing = await File.create({
      filename: "secret.bin", hash: "hash-old", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "telegram/owner/secret-v1.bin", backend: "telegram", status: "uploaded", size: 100,
      encryptionMode: "server", encryptionKey: "old-server-key",
    });
    await FileVersion.create({
      file_id: existing._id, version: 1, backend: "telegram", storageUrl: existing.storageUrl,
      hash: existing.hash, size: existing.size, mimetype: "application/octet-stream", createdBy: owner._id,
    });

    const placeholder = await seedPlaceholder(owner, {
      filename: "secret.bin", encryptionMode: "server", encryptionKey: "new-server-key",
    });
    await addChunk(placeholder._id, 3);

    const res = await POST(makeRequest({ fileId: placeholder._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versioned).toBe(false);

    // Both files survive as independent documents — the old key is never
    // overwritten/lost, and the new content keeps its own key.
    expect(await File.countDocuments({ filename: "secret.bin", owner_id: owner._id })).toBe(2);
    const stillThere = await File.findById(existing._id).lean();
    expect(stillThere?.encryptionKey).toBe("old-server-key");
    const finalized = await File.findById(placeholder._id).lean();
    expect(finalized?.encryptionKey).toBe("new-server-key");
    expect(finalized?.status).toBe("uploaded");
  });

  it("still 400s when not all chunks have arrived", async () => {
    const owner = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const placeholder = await seedPlaceholder(owner, { totalChunks: 2 });
    await addChunk(placeholder._id, 4);

    const res = await POST(makeRequest({ fileId: placeholder._id.toString() }));
    expect(res.status).toBe(400);
  });

  it("still 409s for a non-telegram file", async () => {
    const owner = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const placeholder = await seedPlaceholder(owner, { backend: "s3" });

    const res = await POST(makeRequest({ fileId: placeholder._id.toString() }));
    expect(res.status).toBe(409);
  });
});
