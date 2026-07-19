// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

const sendMock = vi.fn();
vi.mock("@/adapters/storage/s3", () => ({
  s3: { send: (...args: unknown[]) => sendMock(...args) },
  BUCKET: "test-bucket",
}));

import { getAuthUser } from "@/server/auth/auth";
import { POST } from "./route";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/upload/multipart/complete", {
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

async function seedUser(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({ email: "carol@example.com", name: "Carol", provider: "test", storageused: 0, ...overrides });
}

describe("POST /api/files/upload/multipart/complete", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ key: "k", uploadId: "u", parts: [], fileId: "f" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({ key: "k" }));
    expect(res.status).toBe(400);
  });

  it("marks a pending file as uploaded, creates version 1, and increments storage usage", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 100 * 1024 * 1024 });
    const file = await File.create({
      filename: "report.pdf", hash: "h1", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/carol/report.pdf", backend: "s3", status: "s3_pending", size: 1024, mimetype: "application/pdf",
    });
    sendMock.mockResolvedValue({});

    const res = await POST(makeRequest({
      key: file.storageUrl, uploadId: "aws-up-1",
      parts: [{ PartNumber: 1, ETag: "\"etag1\"" }],
      fileId: file._id.toString(),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.file.status).toBe("uploaded");

    const updatedUser = await User.findById(user._id).lean();
    expect(updatedUser?.storageused).toBe(1024);

    const versions = await FileVersion.find({ file_id: file._id }).lean();
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].backend).toBe("s3");
  });

  it("is idempotent: completing an already-uploaded file does not double-count storage", async () => {
    const user = await seedUser({ storageused: 1024 });
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 1024, storagelimit: 100 * 1024 * 1024 });
    const file = await File.create({
      filename: "already.pdf", hash: "h2", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/carol/already.pdf", backend: "s3", status: "uploaded", size: 1024,
    });
    sendMock.mockResolvedValue({});

    const res = await POST(makeRequest({ key: file.storageUrl, uploadId: "aws-up-2", parts: [{ PartNumber: 1, ETag: "\"e\"" }], fileId: file._id.toString() }));
    expect(res.status).toBe(200);

    const updatedUser = await User.findById(user._id).lean();
    expect(updatedUser?.storageused).toBe(1024);
    expect(await FileVersion.countDocuments({ file_id: file._id })).toBe(0);
  });

  it("versions an existing same-name file instead of creating a duplicate when completing a re-upload", async () => {
    const user = await seedUser({ storageused: 500 });
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 500, storagelimit: 100 * 1024 * 1024 });

    const original = await File.create({
      filename: "doc.txt", hash: "original-hash", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/carol/doc-v1.txt", backend: "s3", status: "uploaded", size: 500, folderId: null,
    });
    const reupload = await File.create({
      filename: "doc.txt", hash: "new-hash", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/carol/doc-v2.txt", backend: "s3", status: "pending", size: 800, folderId: null,
    });
    sendMock.mockResolvedValue({});

    const res = await POST(makeRequest({ key: reupload.storageUrl, uploadId: "aws-up-3", parts: [{ PartNumber: 1, ETag: "\"e\"" }], fileId: reupload._id.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versioned).toBe(true);
    expect(body.version).toBe(2);

    // The re-upload's own File document is removed; the original absorbs the new content.
    expect(await File.findById(reupload._id)).toBeNull();
    const updatedOriginal = await File.findById(original._id).lean();
    expect(updatedOriginal?.hash).toBe("new-hash");
    expect(updatedOriginal?.size).toBe(800);

    const updatedUser = await User.findById(user._id).lean();
    expect(updatedUser?.storageused).toBe(500 + (800 - 500));
  });

  it("returns 500 (not an unhandled crash) when S3 CompleteMultipartUpload fails", async () => {
    const user = await seedUser();
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 100 * 1024 * 1024 });
    const file = await File.create({
      filename: "fail.bin", hash: "h3", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/carol/fail.bin", backend: "s3", status: "s3_pending", size: 10,
    });
    sendMock.mockRejectedValue(new Error("part ETag mismatch"));

    const res = await POST(makeRequest({ key: file.storageUrl, uploadId: "aws-up-4", parts: [{ PartNumber: 1, ETag: "\"e\"" }], fileId: file._id.toString() }));
    expect(res.status).toBe(500);

    const unchanged = await File.findById(file._id).lean();
    expect(unchanged?.status).toBe("s3_pending");
  });
});
