// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

const getSignedUrlMock = vi.fn().mockResolvedValue("https://s3.example/signed-version-url");
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));
vi.mock("@/adapters/storage/s3", () => ({
  s3: {},
  BUCKET: "test-bucket",
}));

import { getAuthUser } from "@/server/auth/auth";
import { GET, POST } from "./route";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeGetRequest() {
  return new NextRequest("http://localhost/api/files/x/versions");
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/x/versions", {
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

async function seedFileWithVersions(owner: InstanceType<typeof User>) {
  const file = await File.create({
    filename: "report.pdf", hash: "hash-v2", owner_email: owner.email, owner_id: owner._id,
    storageUrl: "uploads/owner/report-v2.pdf", backend: "s3", status: "uploaded", size: 2000, mimetype: "application/pdf",
  });
  const v1 = await FileVersion.create({
    file_id: file._id, version: 1, backend: "s3", storageUrl: "uploads/owner/report-v1.pdf",
    hash: "hash-v1", size: 1000, mimetype: "application/pdf", createdBy: owner._id,
  });
  const v2 = await FileVersion.create({
    file_id: file._id, version: 2, backend: "s3", storageUrl: "uploads/owner/report-v2.pdf",
    hash: "hash-v2", size: 2000, mimetype: "application/pdf", createdBy: owner._id,
  });
  await File.findByIdAndUpdate(file._id, { currentVersionId: v2._id });
  return { file, v1, v2 };
}

describe("GET /api/files/:id/versions", () => {
  it("lists every version, newest first, with isCurrent flagged correctly", async () => {
    const owner = await User.create({ email: "lister@example.com", name: "L", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const { file, v2 } = await seedFileWithVersions(owner);

    const res = await GET(makeGetRequest(), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(body.versions.find((v: { id: string }) => v.id === v2._id.toString()).isCurrent).toBe(true);
  });
});

describe("POST /api/files/:id/versions (open a specific version)", () => {
  // Regression test: this query used to be `storage_url` (snake_case) — the
  // schema field is `storageUrl` — so it never matched anything and this
  // endpoint 404'd unconditionally. Confirms the fix.
  it("finds the matching version and returns a signed S3 URL", async () => {
    const owner = await User.create({ email: "opener@example.com", name: "O", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const { file, v1 } = await seedFileWithVersions(owner);

    const res = await POST(makePostRequest({ storageUrl: v1.storageUrl }), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://s3.example/signed-version-url");
    expect(getSignedUrlMock).toHaveBeenCalled();
  });

  it("returns a download-route URL for a Telegram-backend version instead of presigning S3", async () => {
    const owner = await User.create({ email: "opener2@example.com", name: "O2", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const file = await File.create({
      filename: "clip.mp4", hash: "h", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "telegram/clip.mp4", backend: "telegram", status: "uploaded", size: 500,
    });
    const v1 = await FileVersion.create({
      file_id: file._id, version: 1, backend: "telegram", storageUrl: "telegram/clip.mp4",
      hash: "h", size: 500, mimetype: "video/mp4", createdBy: owner._id,
    });
    await File.findByIdAndUpdate(file._id, { currentVersionId: v1._id });

    const res = await POST(makePostRequest({ storageUrl: v1.storageUrl }), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toBe(`/api/files/${file._id}/download?versionId=${v1._id}`);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("404s for a storageUrl that doesn't match any version of the file", async () => {
    const owner = await User.create({ email: "opener3@example.com", name: "O3", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 1 });
    const { file } = await seedFileWithVersions(owner);

    const res = await POST(makePostRequest({ storageUrl: "uploads/owner/does-not-exist.pdf" }), { params: Promise.resolve({ id: file._id.toString() }) });
    expect(res.status).toBe(404);
  });
});
