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

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/fallback-to-s3/init", {
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

async function seedUserAndFile(fileOverrides: Partial<Record<string, unknown>> = {}) {
  const user = await User.create({ email: "bob@example.com", name: "Bob", provider: "test" });
  mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 0, storagelimit: 100 * 1024 * 1024 });
  const file = await File.create({
    filename: "movie.mkv",
    hash: "hash-abc",
    owner_email: user.email,
    owner_id: user._id,
    storageUrl: "uploads/bob/123-movie.mkv",
    backend: "s3",
    status: "s3_pending",
    size: 25 * 1024 * 1024,
    ...fileOverrides,
  });
  return { user, file };
}

describe("POST /api/files/fallback-to-s3/init", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ fileId: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when fileId is missing", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("initiates an S3 multipart upload and computes totalParts", async () => {
    const { file } = await seedUserAndFile();
    sendMock.mockResolvedValue({ UploadId: "aws-upload-id-1" });

    const res = await POST(makeRequest({
      fileId: file._id.toString(),
      filename: file.filename,
      mimeType: "video/x-matroska",
      size: file.size,
      hash: file.hash,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadId).toBe("aws-upload-id-1");
    expect(body.totalParts).toBe(Math.ceil(file.size / (10 * 1024 * 1024)));
    expect(body.key).toBe(file.storageUrl);

    const updated = await File.findById(file._id).lean();
    expect(updated?.uploadId).toBe("aws-upload-id-1");
    expect(updated?.status).toBe("s3_pending");
  });

  it("returns 403 when the requester does not own the file", async () => {
    const { file } = await seedUserAndFile();
    const otherUser = await User.create({ email: "mallory@example.com", name: "Mallory", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: otherUser._id.toString(), email: otherUser.email, provider: "test", storageused: 0, storagelimit: 100 });

    const res = await POST(makeRequest({ fileId: file._id.toString(), filename: file.filename, mimeType: "video/mp4", size: file.size, hash: file.hash }));
    expect(res.status).toBe(403);
  });

  it("returns 413 when the user is over their storage quota", async () => {
    const user = await User.create({ email: "quota@example.com", name: "Q", provider: "test", storageused: 90, storagelimit: 100 });
    mockGetAuthUser.mockResolvedValue({ userId: user._id.toString(), email: user.email, provider: "test", storageused: 90, storagelimit: 100 });
    const file = await File.create({
      filename: "big.bin", hash: "h", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/quota/big.bin", backend: "s3", status: "s3_pending", size: 50,
    });

    const res = await POST(makeRequest({ fileId: file._id.toString(), filename: file.filename, mimeType: "application/octet-stream", size: 50, hash: "h" }));
    expect(res.status).toBe(413);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 409 when a completed upload with the same hash already exists", async () => {
    const { user, file } = await seedUserAndFile();
    await File.create({
      filename: "dup.mkv", hash: file.hash, owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/bob/already-uploaded.mkv", backend: "s3", status: "uploaded", size: file.size,
    });

    const res = await POST(makeRequest({ fileId: file._id.toString(), filename: file.filename, mimeType: "video/mp4", size: file.size, hash: file.hash }));
    expect(res.status).toBe(409);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 500 and does not throw when S3 CreateMultipartUpload rejects", async () => {
    const { file } = await seedUserAndFile();
    sendMock.mockRejectedValue(new Error("S3 unavailable"));

    const res = await POST(makeRequest({ fileId: file._id.toString(), filename: file.filename, mimeType: "video/mp4", size: file.size, hash: file.hash }));
    expect(res.status).toBe(500);

    const unchanged = await File.findById(file._id).lean();
    expect(unchanged?.uploadId).toBeUndefined();
  });
});
