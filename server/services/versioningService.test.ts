// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";
import {
  findConflictingUploadedFile,
  mergeAsNewVersion,
  createInitialVersion,
  wouldConflictServerEncryptionKey,
  restoreVersion,
} from "./versioningService";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import TelegramChunk from "@/adapters/database/models/TelegramChunk";
import User from "@/adapters/database/models/User";

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

afterEach(async () => {
  await clearTestDB();
});

async function seedOwner(overrides: Partial<Record<string, unknown>> = {}) {
  return User.create({ email: "owner@example.com", name: "Owner", provider: "test", storageused: 0, ...overrides });
}

async function seedUploadedFile(ownerId: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return File.create({
    filename: "report.pdf",
    hash: "hash-v1",
    owner_email: "owner@example.com",
    owner_id: ownerId,
    folderId: null,
    storageUrl: "uploads/owner/report-v1.pdf",
    backend: "s3",
    status: "uploaded",
    size: 1000,
    ...overrides,
  });
}

async function withSession<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

describe("findConflictingUploadedFile", () => {
  it("finds a same-name, different-hash, uploaded file", async () => {
    const owner = await seedOwner();
    const existing = await seedUploadedFile(owner._id);

    const found = await withSession((session) =>
      findConflictingUploadedFile({ session, filename: "report.pdf", ownerId: owner._id, folderId: null, hash: "hash-v2" })
    );

    expect(found?._id.toString()).toBe(existing._id.toString());
  });

  it("does not match the same hash (that's an exact-duplicate, handled elsewhere)", async () => {
    const owner = await seedOwner();
    await seedUploadedFile(owner._id);

    const found = await withSession((session) =>
      findConflictingUploadedFile({ session, filename: "report.pdf", ownerId: owner._id, folderId: null, hash: "hash-v1" })
    );
    expect(found).toBeNull();
  });

  it("excludes a given fileId (the placeholder never conflicts with itself)", async () => {
    const owner = await seedOwner();
    const existing = await seedUploadedFile(owner._id);

    const found = await withSession((session) =>
      findConflictingUploadedFile({ session, filename: "report.pdf", ownerId: owner._id, folderId: null, hash: "hash-v2", excludeFileId: existing._id })
    );
    expect(found).toBeNull();
  });

  it("ignores soft-deleted files", async () => {
    const owner = await seedOwner();
    await seedUploadedFile(owner._id, { deleted: true, deletedAt: new Date() });

    const found = await withSession((session) =>
      findConflictingUploadedFile({ session, filename: "report.pdf", ownerId: owner._id, folderId: null, hash: "hash-v2" })
    );
    expect(found).toBeNull();
  });
});

describe("wouldConflictServerEncryptionKey", () => {
  it("is false when neither side has a server-held key", () => {
    expect(wouldConflictServerEncryptionKey({ encryptionKey: null }, null)).toBe(false);
  });
  it("is false when only the new content is server-encrypted (nothing to lose)", () => {
    expect(wouldConflictServerEncryptionKey({ encryptionKey: null }, "new-key")).toBe(false);
  });
  it("is true when both the existing file and the new content have a server-held key", () => {
    expect(wouldConflictServerEncryptionKey({ encryptionKey: "old-key" }, "new-key")).toBe(true);
  });
});

describe("mergeAsNewVersion", () => {
  it("creates version 2, updates the cached fields, and adjusts storageused by the size delta", async () => {
    const owner = await seedOwner({ storageused: 1000 });
    const existing = await seedUploadedFile(owner._id);
    await FileVersion.create({
      file_id: existing._id, version: 1, backend: "s3", storageUrl: existing.storageUrl,
      hash: existing.hash, size: existing.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    const result = await withSession((session) =>
      mergeAsNewVersion({
        session,
        existingFile: existing,
        content: { backend: "s3", storageUrl: "uploads/owner/report-v2.pdf", hash: "hash-v2", size: 2500, mimetype: "application/pdf" },
        createdBy: owner._id,
        extraFileFields: { searchText: "new content" },
      })
    );

    expect(result.version).toBe(2);
    expect(result.versioned).toBe(true);

    const versions = await FileVersion.find({ file_id: existing._id }).sort({ version: 1 }).lean();
    expect(versions).toHaveLength(2);
    expect(versions[0].version).toBe(1);
    expect(versions[0].hash).toBe("hash-v1"); // untouched history
    expect(versions[1].version).toBe(2);
    expect(versions[1].hash).toBe("hash-v2");

    const updatedFile = await File.findById(existing._id).lean();
    expect(updatedFile?.hash).toBe("hash-v2");
    expect(updatedFile?.size).toBe(2500);
    expect(updatedFile?.storageUrl).toBe("uploads/owner/report-v2.pdf");
    expect(updatedFile?.searchText).toBe("new content");
    expect(updatedFile?.currentVersionId?.toString()).toBe(versions[1]._id.toString());

    const updatedOwner = await User.findById(owner._id).lean();
    expect(updatedOwner?.storageused).toBe(1000 + (2500 - 1000));
  });

  it("deletes the placeholder file and re-points its TelegramChunk rows (fileId + versionId) to the surviving file", async () => {
    const owner = await seedOwner();
    const existing = await seedUploadedFile(owner._id, { backend: "telegram" });
    await FileVersion.create({
      file_id: existing._id, version: 1, backend: "telegram", storageUrl: existing.storageUrl,
      hash: existing.hash, size: existing.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    const placeholder = await File.create({
      filename: "report.pdf", hash: "hash-v2", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "telegram/owner/report-v2.pdf", backend: "telegram", status: "uploading", size: 3000,
    });
    await TelegramChunk.create({
      fileId: placeholder._id, chunkIndex: 0, hash: "h", plaintextHash: "h", size: 3000,
      telegramMessageId: 111, telegramFileId: "tg-1",
    });

    const result = await withSession((session) =>
      mergeAsNewVersion({
        session,
        existingFile: existing,
        content: { backend: "telegram", storageUrl: placeholder.storageUrl, hash: "hash-v2", size: 3000, mimetype: "application/pdf" },
        createdBy: owner._id,
        placeholderFileId: placeholder._id,
      })
    );

    expect(await File.findById(placeholder._id)).toBeNull();

    const chunk = await TelegramChunk.findOne({ telegramMessageId: 111 }).lean();
    expect(chunk?.fileId.toString()).toBe(existing._id.toString());
    expect(chunk?.versionId?.toString()).toBe(result.versionId);

    // The chunk is now findable by the surviving file's id — the exact
    // query fileService.hardDeleteFile uses to clean up Telegram chunks —
    // proving a later hard-delete of `existing` won't orphan it.
    expect(await TelegramChunk.countDocuments({ fileId: existing._id })).toBe(1);
  });

  it("two concurrent merges of the same logical file never produce duplicate version numbers or crash the caller", async () => {
    const owner = await seedOwner({ storageused: 1000 });
    const existing = await seedUploadedFile(owner._id);
    await FileVersion.create({
      file_id: existing._id, version: 1, backend: "s3", storageUrl: existing.storageUrl,
      hash: existing.hash, size: existing.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    const mergeOnce = (hash: string, size: number) =>
      withSession(async (session) => {
        // Each concurrent request re-fetches its own copy of the file
        // within its own session, exactly like two separate HTTP requests
        // each running findConflictingUploadedFile + mergeAsNewVersion.
        const fresh = await File.findById(existing._id).session(session);
        return mergeAsNewVersion({
          session,
          existingFile: fresh!,
          content: { backend: "s3", storageUrl: `uploads/owner/${hash}.pdf`, hash, size, mimetype: "application/pdf" },
          createdBy: owner._id,
        });
      });

    const results = await Promise.allSettled([mergeOnce("hash-a", 1500), mergeOnce("hash-b", 2000)]);

    // Every settled outcome is either a clean success or a well-formed
    // rejection — never an unhandled crash.
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeTruthy();
      }
    }

    const versions = await FileVersion.find({ file_id: existing._id }).sort({ version: 1 }).lean();
    const versionNumbers = versions.map((v) => v.version);
    // The hard invariant: no duplicate version numbers, regardless of how
    // many of the two racing merges actually committed.
    expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
    expect(versionNumbers[0]).toBe(1);
  });
});

describe("createInitialVersion", () => {
  it("finalizes a placeholder as version 1 and sets currentVersionId", async () => {
    const owner = await seedOwner();
    const placeholder = await File.create({
      filename: "new.pdf", hash: "hash-1", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "uploads/owner/new.pdf", backend: "s3", status: "pending", size: 500,
    });

    const result = await withSession((session) =>
      createInitialVersion({
        session,
        file: placeholder,
        content: { backend: "s3", storageUrl: "uploads/owner/new.pdf", hash: "hash-1", size: 500, mimetype: "application/pdf" },
        createdBy: owner._id,
      })
    );

    expect(result.version).toBe(1);
    expect(result.versioned).toBe(false);

    const file = await File.findById(placeholder._id).lean();
    expect(file?.status).toBe("uploaded");
    expect(file?.currentVersionId?.toString()).toBe(result.versionId);

    const updatedOwner = await User.findById(owner._id).lean();
    expect(updatedOwner?.storageused).toBe(500);
  });
});

describe("restoreVersion", () => {
  it("restores an old version as a new current version without touching prior history", async () => {
    const owner = await seedOwner({ storageused: 3000 });
    const file = await seedUploadedFile(owner._id, { size: 3000, hash: "hash-v3", storageUrl: "uploads/owner/v3.pdf" });
    const v1 = await FileVersion.create({
      file_id: file._id, version: 1, backend: "s3", storageUrl: "uploads/owner/v1.pdf",
      hash: "hash-v1", size: 1000, mimetype: "application/pdf", createdBy: owner._id,
    });
    await FileVersion.create({
      file_id: file._id, version: 2, backend: "s3", storageUrl: "uploads/owner/v2.pdf",
      hash: "hash-v2", size: 2000, mimetype: "application/pdf", createdBy: owner._id,
    });
    const v3 = await FileVersion.create({
      file_id: file._id, version: 3, backend: "s3", storageUrl: "uploads/owner/v3.pdf",
      hash: "hash-v3", size: 3000, mimetype: "application/pdf", createdBy: owner._id,
    });
    await File.findByIdAndUpdate(file._id, { currentVersionId: v3._id });

    const result = await restoreVersion(owner._id.toString(), file._id.toString(), v1._id.toString());

    expect(result.version).toBe(4); // new version at the end of history, not a rewrite of v1
    expect(result.versioned).toBe(true);

    const allVersions = await FileVersion.find({ file_id: file._id }).sort({ version: 1 }).lean();
    expect(allVersions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    expect(allVersions[0].hash).toBe("hash-v1"); // original v1 row untouched
    expect(allVersions[3].hash).toBe("hash-v1"); // new v4 points at v1's content

    const updatedFile = await File.findById(file._id).lean();
    expect(updatedFile?.hash).toBe("hash-v1");
    expect(updatedFile?.size).toBe(1000);
    expect(updatedFile?.currentVersionId?.toString()).toBe(allVersions[3]._id.toString());

    const updatedOwner = await User.findById(owner._id).lean();
    expect(updatedOwner?.storageused).toBe(3000 + (1000 - 3000));
  });

  it("rejects restoring the version that is already current", async () => {
    const owner = await seedOwner();
    const file = await seedUploadedFile(owner._id);
    const v1 = await FileVersion.create({
      file_id: file._id, version: 1, backend: "s3", storageUrl: file.storageUrl,
      hash: file.hash, size: file.size, mimetype: "application/pdf", createdBy: owner._id,
    });
    await File.findByIdAndUpdate(file._id, { currentVersionId: v1._id });

    await expect(restoreVersion(owner._id.toString(), file._id.toString(), v1._id.toString()))
      .rejects.toMatchObject({ status: 400 });
  });

  it("404s for a version that does not belong to the file", async () => {
    const owner = await seedOwner();
    const file = await seedUploadedFile(owner._id);
    const otherFile = await seedUploadedFile(owner._id, { hash: "other-hash", filename: "other.pdf" });
    const otherVersion = await FileVersion.create({
      file_id: otherFile._id, version: 1, backend: "s3", storageUrl: otherFile.storageUrl,
      hash: otherFile.hash, size: otherFile.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    await expect(restoreVersion(owner._id.toString(), file._id.toString(), otherVersion._id.toString()))
      .rejects.toMatchObject({ status: 404 });
  });

  it("404s when the requester does not own the file", async () => {
    const owner = await seedOwner();
    const stranger = await seedOwner({ email: "stranger@example.com" });
    const file = await seedUploadedFile(owner._id);
    const v1 = await FileVersion.create({
      file_id: file._id, version: 1, backend: "s3", storageUrl: file.storageUrl,
      hash: file.hash, size: file.size, mimetype: "application/pdf", createdBy: owner._id,
    });

    await expect(restoreVersion(stranger._id.toString(), file._id.toString(), v1._id.toString()))
      .rejects.toMatchObject({ status: 404 });
  });
});
