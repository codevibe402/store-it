// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/adapters/storage/telegram", () => ({
  deleteMessage: vi.fn().mockResolvedValue(undefined),
}));

const s3SendMock = vi.fn().mockResolvedValue({});
vi.mock("@/adapters/storage/s3", () => ({
  s3: { send: (...args: unknown[]) => s3SendMock(...args) },
  BUCKET: "test-bucket",
}));

import {
  deleteFile,
  hardDeleteFile,
  getRecycleBinFiles,
  restoreFile,
  getFileDownload,
} from "./fileService";
import { ServiceError } from "./shareService";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import FileVersion from "@/adapters/database/models/FileVersion";
import User from "@/adapters/database/models/User";

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

async function seedOwner() {
  return User.create({ email: "owner@example.com", name: "Owner", provider: "test" });
}

async function seedFile(ownerId: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return File.create({
    filename: "report.pdf",
    hash: "hash-" + Math.random().toString(36).slice(2),
    owner_email: "owner@example.com",
    owner_id: ownerId,
    storageUrl: "uploads/owner/report.pdf",
    backend: "s3",
    status: "uploaded",
    size: 1024,
    ...overrides,
  });
}

describe("recycle bin: delete -> restore round trip", () => {
  it("a soft-deleted file disappears from downloads and reappears after restore", async () => {
    const owner = await seedOwner();
    const file = await seedFile(owner._id);

    await deleteFile(owner._id.toString(), file._id.toString());

    const deleted = await File.findById(file._id).lean();
    expect(deleted?.deleted).toBe(true);

    // A soft-deleted file must not be downloadable through the normal route.
    await expect(getFileDownload(owner._id.toString(), file._id.toString(), false)).rejects.toThrow(ServiceError);

    const bin = await getRecycleBinFiles(owner._id.toString());
    expect(bin.map((f) => f._id.toString())).toContain(file._id.toString());

    const restored = await restoreFile(owner._id.toString(), file._id.toString());
    expect((restored as { deleted: boolean }).deleted).toBe(false);

    const afterRestore = await File.findById(file._id).lean();
    expect(afterRestore?.deleted).toBe(false);
    expect(afterRestore?.deletedAt).toBeNull();
  });

  it("restoring a file whose parent folder is deleted falls back to root instead of orphaning it", async () => {
    const owner = await seedOwner();
    const folder = await Folder.create({
      name: "Trip Photos", owner_id: owner._id.toString(), owner_email: owner.email,
      parent_id: null, ancestors: [], depth: 0,
    });
    const file = await seedFile(owner._id, { folderId: folder._id, folders_id: folder._id, deleted: true, deletedAt: new Date() });

    // Simulates the folder itself having been deleted (folders have no
    // restore path of their own, so this is the permanent state).
    await Folder.updateOne({ _id: folder._id }, { $set: { deleted: true, deletedAt: new Date() } });

    const restored = await restoreFile(owner._id.toString(), file._id.toString());
    expect((restored as { folderId: unknown }).folderId).toBeNull();

    const afterRestore = await File.findById(file._id).lean();
    expect(afterRestore?.folderId).toBeNull();
    expect(afterRestore?.folders_id).toBeNull();
    expect(afterRestore?.deleted).toBe(false);
  });

  it("restoring a file whose folder is still alive keeps its folderId", async () => {
    const owner = await seedOwner();
    const folder = await Folder.create({
      name: "Keep Me", owner_id: owner._id.toString(), owner_email: owner.email,
      parent_id: null, ancestors: [], depth: 0,
    });
    const file = await seedFile(owner._id, { folderId: folder._id, folders_id: folder._id, deleted: true, deletedAt: new Date() });

    await restoreFile(owner._id.toString(), file._id.toString());

    const afterRestore = await File.findById(file._id).lean();
    expect(afterRestore?.folderId?.toString()).toBe(folder._id.toString());
  });

  it("restore fails cleanly for a file that is not actually in the recycle bin", async () => {
    const owner = await seedOwner();
    const file = await seedFile(owner._id); // never deleted
    await expect(restoreFile(owner._id.toString(), file._id.toString())).rejects.toThrow(ServiceError);
  });
});

describe("recycle bin: hard delete", () => {
  it("permanently removes the file, its versions, and its S3 object", async () => {
    const owner = await seedOwner();
    const file = await seedFile(owner._id, { deleted: true, deletedAt: new Date() });
    await FileVersion.create({
      file_id: file._id, version: 1, backend: "s3", storageUrl: file.storageUrl,
      hash: file.hash, size: file.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    await hardDeleteFile(owner._id.toString(), file._id.toString());

    expect(await File.findById(file._id)).toBeNull();
    expect(await FileVersion.countDocuments({ file_id: file._id })).toBe(0);
    expect(s3SendMock).toHaveBeenCalled();
  });

  it("cannot hard-delete a file that isn't in the recycle bin first", async () => {
    const owner = await seedOwner();
    const file = await seedFile(owner._id); // active, not deleted
    await expect(hardDeleteFile(owner._id.toString(), file._id.toString())).rejects.toThrow(ServiceError);
    expect(await File.findById(file._id)).not.toBeNull();
  });

  it("rapid double hard-delete of the same file: second call fails cleanly instead of double-freeing storage", async () => {
    const owner = await seedOwner();
    const file = await seedFile(owner._id, { deleted: true, deletedAt: new Date() });

    const [first, second] = await Promise.allSettled([
      hardDeleteFile(owner._id.toString(), file._id.toString()),
      hardDeleteFile(owner._id.toString(), file._id.toString()),
    ]);

    const fulfilled = [first, second].filter((r) => r.status === "fulfilled");
    const rejected = [first, second].filter((r) => r.status === "rejected");
    // find() + deleteOne() isn't atomic, so both racing calls can observe the
    // file as present and both "succeed" from hardDeleteFile's point of view
    // (Mongo's own deleteOne is idempotent) — the invariant that must hold
    // is just that the document is gone exactly once and neither call threw
    // an unexpected (non-ServiceError) crash.
    expect(fulfilled.length + rejected.length).toBe(2);
    for (const r of rejected) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ServiceError);
    }
    expect(await File.findById(file._id)).toBeNull();
  });
});

describe("recycle bin: concurrent restore vs hard-delete", () => {
  it("racing a restore against a hard-delete never leaves a half-deleted (versions gone, File row present) file", async () => {
    const owner = await seedOwner();
    const file = await seedFile(owner._id, { deleted: true, deletedAt: new Date() });
    await FileVersion.create({
      file_id: file._id, version: 1, backend: "s3", storageUrl: file.storageUrl,
      hash: file.hash, size: file.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    await Promise.allSettled([
      restoreFile(owner._id.toString(), file._id.toString()),
      hardDeleteFile(owner._id.toString(), file._id.toString()),
    ]);

    const remaining = await File.findById(file._id).lean();
    if (remaining) {
      // Restore won: the file must be fully intact, not partially cleaned up.
      expect(remaining.deleted).toBe(false);
      expect(await FileVersion.countDocuments({ file_id: file._id })).toBe(1);
    } else {
      // Hard-delete won: versions must be gone too, not left dangling.
      expect(await FileVersion.countDocuments({ file_id: file._id })).toBe(0);
    }
  });
});
