// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

import { getAuthUser } from "@/server/auth/auth";
import { POST } from "./route";
import User from "@/adapters/database/models/User";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeRequest() {
  return new NextRequest("http://localhost/api/files/x/versions/y/restore", { method: "POST" });
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

async function seedFileWithHistory(owner: InstanceType<typeof User>) {
  const file = await File.create({
    filename: "report.pdf", hash: "hash-v2", owner_email: owner.email, owner_id: owner._id,
    storageUrl: "uploads/owner/report-v2.pdf", backend: "s3", status: "uploaded", size: 2000,
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

describe("POST /api/files/:id/versions/:versionId/restore", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "x", versionId: "y" }) });
    expect(res.status).toBe(401);
  });

  it("restores an old version as a new current version, keeping full history", async () => {
    const owner = await User.create({ email: "restorer@example.com", name: "R", provider: "test", storageused: 2000 });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 2000, storagelimit: 100000 });
    const { file, v1 } = await seedFileWithHistory(owner);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: file._id.toString(), versionId: v1._id.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(3);

    const versions = await FileVersion.find({ file_id: file._id }).sort({ version: 1 }).lean();
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[2].hash).toBe("hash-v1");

    const updated = await File.findById(file._id).lean();
    expect(updated?.hash).toBe("hash-v1");
    expect(updated?.size).toBe(1000);
    expect(updated?.currentVersionId?.toString()).toBe(versions[2]._id.toString());

    const updatedOwner = await User.findById(owner._id).lean();
    expect(updatedOwner?.storageused).toBe(2000 + (1000 - 2000));
  });

  it("rejects restoring the already-current version", async () => {
    const owner = await User.create({ email: "restorer2@example.com", name: "R2", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 100000 });
    const { file, v2 } = await seedFileWithHistory(owner);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: file._id.toString(), versionId: v2._id.toString() }) });
    expect(res.status).toBe(400);
  });

  it("404s for another user's file (no ownership)", async () => {
    const owner = await User.create({ email: "victim@example.com", name: "V", provider: "test" });
    const stranger = await User.create({ email: "stranger@example.com", name: "S", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: stranger._id.toString(), email: stranger.email, provider: "test", storageused: 0, storagelimit: 100000 });
    const { file, v1 } = await seedFileWithHistory(owner);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: file._id.toString(), versionId: v1._id.toString() }) });
    expect(res.status).toBe(404);
  });

  it("404s for a version id that doesn't belong to the file", async () => {
    const owner = await User.create({ email: "restorer3@example.com", name: "R3", provider: "test" });
    mockGetAuthUser.mockResolvedValue({ userId: owner._id.toString(), email: owner.email, provider: "test", storageused: 0, storagelimit: 100000 });
    const { file } = await seedFileWithHistory(owner);
    const otherFile = await File.create({
      filename: "other.pdf", hash: "other-hash", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "uploads/owner/other.pdf", backend: "s3", status: "uploaded", size: 10,
    });
    const otherVersion = await FileVersion.create({
      file_id: otherFile._id, version: 1, backend: "s3", storageUrl: otherFile.storageUrl,
      hash: otherFile.hash, size: 10, mimetype: "application/pdf", createdBy: owner._id,
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: file._id.toString(), versionId: otherVersion._id.toString() }) });
    expect(res.status).toBe(404);
  });
});
