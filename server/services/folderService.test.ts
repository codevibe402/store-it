// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

const s3SendMock = vi.fn();
vi.mock("@/adapters/storage/s3", () => ({
  s3: { send: (...args: unknown[]) => s3SendMock(...args) },
  BUCKET: "test-bucket",
}));

import {
  softDeleteFolderFast,
  cascadeDeleteFolderContents,
  downloadFolderAsZip,
  moveFolder,
} from "./folderService";
import { ServiceError } from "./shareService";
import File from "@/adapters/database/models/File";
import Folder from "@/adapters/database/models/Folder";
import User from "@/adapters/database/models/User";
import JSZip from "jszip";

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
  return User.create({ email: "root@example.com", name: "Root", provider: "test" });
}

async function seedFolder(ownerId: { toString(): string }, name: string, overrides: Partial<Record<string, unknown>> = {}) {
  return Folder.create({
    name, owner_id: ownerId.toString(), owner_email: "root@example.com",
    parent_id: null, ancestors: [], depth: 0,
    ...overrides,
  });
}

describe("folder delete cascade", () => {
  it("rapidly deleting a folder hides descendant folders and moves every contained file to the recycle bin", async () => {
    const owner = await seedOwner();
    const parent = await seedFolder(owner._id, "Parent");
    const child = await seedFolder(owner._id, "Child", { parent_id: parent._id.toString(), ancestors: [parent._id], depth: 1 });

    const fileInParent = await File.create({
      filename: "a.txt", hash: "h1", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "s3/a.txt", backend: "s3", status: "uploaded", size: 10,
      folderId: parent._id, folders_id: parent._id,
    });
    const fileInChild = await File.create({
      filename: "b.txt", hash: "h2", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "s3/b.txt", backend: "s3", status: "uploaded", size: 10,
      folderId: child._id, folders_id: child._id,
    });

    await softDeleteFolderFast(owner._id.toString(), parent._id.toString());
    // softDeleteFolderFast only marks the folder itself — descendants and
    // files are untouched until the (normally after()-scheduled) cascade runs.
    expect((await Folder.findById(child._id).lean())?.deleted).toBeFalsy();

    await cascadeDeleteFolderContents(parent._id.toString());

    expect((await Folder.findById(parent._id).lean())?.deleted).toBe(true);
    expect((await Folder.findById(child._id).lean())?.deleted).toBe(true);
    expect((await File.findById(fileInParent._id).lean())?.deleted).toBe(true);
    expect((await File.findById(fileInChild._id).lean())?.deleted).toBe(true);
  });

  it("a second concurrent cascade run over the same subtree is a safe no-op", async () => {
    const owner = await seedOwner();
    const folder = await seedFolder(owner._id, "Solo");
    const file = await File.create({
      filename: "a.txt", hash: "h1", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "s3/a.txt", backend: "s3", status: "uploaded", size: 10,
      folderId: folder._id, folders_id: folder._id,
    });

    await softDeleteFolderFast(owner._id.toString(), folder._id.toString());
    await Promise.all([
      cascadeDeleteFolderContents(folder._id.toString()),
      cascadeDeleteFolderContents(folder._id.toString()),
    ]);

    expect((await File.findById(file._id).lean())?.deleted).toBe(true);
    expect(await File.countDocuments({ _id: file._id })).toBe(1);
  });

  it("deleting the same folder twice in a row fails cleanly the second time (not already in the recycle bin)", async () => {
    const owner = await seedOwner();
    const folder = await seedFolder(owner._id, "OnlyOnce");

    await softDeleteFolderFast(owner._id.toString(), folder._id.toString());
    await expect(softDeleteFolderFast(owner._id.toString(), folder._id.toString())).rejects.toThrow(ServiceError);
  });
});

describe("concurrent folder moves", () => {
  it("racing two moves of the same folder to different targets never leaves a torn/blended state", async () => {
    const owner = await seedOwner();
    const moving = await seedFolder(owner._id, "Moving");
    const targetA = await seedFolder(owner._id, "TargetA");
    const targetB = await seedFolder(owner._id, "TargetB");

    // Note: this doesn't reliably reproduce an actual opVersion write
    // conflict — mongodb-memory-server's in-process replica set resolves
    // each transaction fast enough that two Promise.all-raced moveFolder
    // calls typically just serialize (both fully commit, each reading fresh
    // data), rather than colliding mid-transaction. The invariant that
    // matters regardless of which interleaving happens is checked below:
    // the CAS write itself, tested directly further down, and that the
    // folder never ends up in a state that isn't exactly one of the two
    // requested targets.
    const results = await Promise.allSettled([
      moveFolder(owner._id.toString(), moving._id.toString(), targetA._id.toString()),
      moveFolder(owner._id.toString(), moving._id.toString(), targetB._id.toString()),
    ]);

    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(ServiceError);
    }

    const final = await Folder.findById(moving._id).lean();
    expect([String(targetA._id), String(targetB._id)]).toContain(String(final?.parent_id));
  });

  it("the move CAS write is a no-op once opVersion has already moved on (the actual conflict guard)", async () => {
    const owner = await seedOwner();
    const moving = await seedFolder(owner._id, "Moving");
    const targetA = await seedFolder(owner._id, "TargetA");

    const before = await Folder.findById(moving._id).lean();
    const staleOpVersion = before!.opVersion;

    // A real move bumps opVersion...
    await moveFolder(owner._id.toString(), moving._id.toString(), targetA._id.toString());

    // ...so a write still holding the pre-move opVersion (exactly what a
    // transaction that read the folder before the other one committed would
    // be holding) must match nothing — this is the exact filter moveFolder
    // uses to detect a concurrent modification.
    const staleCasAttempt = await Folder.updateOne(
      { _id: moving._id, opVersion: staleOpVersion },
      { $set: { name: "should not apply" } },
    );
    expect(staleCasAttempt.matchedCount).toBe(0);
  });
});

describe("folder ZIP download excludes recycle-bin contents", () => {
  it("a file that was individually soft-deleted inside an otherwise-live folder is not bundled into the ZIP", async () => {
    const owner = await seedOwner();
    const folder = await seedFolder(owner._id, "Mixed");
    await File.create({
      filename: "keep.txt", hash: "h1", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "s3/keep.txt", backend: "s3", status: "uploaded", size: 10,
      folderId: folder._id, folders_id: folder._id,
    });
    await File.create({
      filename: "trashed.txt", hash: "h2", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "s3/trashed.txt", backend: "s3", status: "uploaded", size: 10,
      folderId: folder._id, folders_id: folder._id, deleted: true, deletedAt: new Date(),
    });

    s3SendMock.mockImplementation(async (cmd: { input: { Key: string } }) => ({
      Body: (async function* () { yield new TextEncoder().encode(`content of ${cmd.input.Key}`); })(),
    }));

    const { zipBuffer } = await downloadFolderAsZip(owner._id.toString(), folder._id.toString());
    const zip = await JSZip.loadAsync(zipBuffer);
    expect(Object.keys(zip.files)).toEqual(["keep.txt"]);
  });
});
