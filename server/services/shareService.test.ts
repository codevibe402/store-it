// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

const createS3DownloadUrlMock = vi.fn(async (storageUrl: string, filename?: string, mimetype?: string, disposition?: string) => `https://s3.example/${storageUrl}`);
vi.mock("@/server/lib/download", () => ({
  createS3DownloadUrl: (storageUrl: string, filename: string, mimetype: string, disposition?: string) =>
    createS3DownloadUrlMock(storageUrl, filename, mimetype, disposition),
}));

import { createFileShare, getSharedFileByToken } from "./shareService";
import File from "@/adapters/database/models/File";
import FileVersion from "@/adapters/database/models/FileVersion";
import FileShare from "@/adapters/database/models/Fileshare";
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

describe("file share links are revoked by deleting the file", () => {
  // Telegram-backend shares resolve through getSharedFileByToken's own fresh
  // File lookup on every access — that's the path server/services/
  // shareService.ts's `deleted: { $ne: true }` fix applies to.
  it("a Telegram-backend share link created before the file was deleted stops resolving afterward", async () => {
    const user = await User.create({ email: "shareowner@example.com", name: "Owner", provider: "test" });
    const file = await File.create({
      filename: "secret.bin", hash: "h1", owner_email: user.email, owner_id: user._id,
      storageUrl: "telegram/secret.bin", backend: "telegram", status: "uploaded", size: 100,
    });

    const { shareUrl } = await createFileShare(user._id.toString(), file._id.toString());
    const token = shareUrl.split("/").pop()!;
    const share = await FileShare.findOne({ shareToken: token }).lean();
    expect(share).not.toBeNull();

    // Works before delete (throws for a different, expected reason — no
    // FileVersion exists in this minimal fixture — proving the lookup got
    // past the file-existence check).
    await expect(getSharedFileByToken(share!.shareToken)).rejects.toThrow(/Version not found/);

    // Soft-delete the file (recycle bin), same as a normal user-initiated delete.
    await File.findByIdAndUpdate(file._id, { deleted: true, deletedAt: new Date() });

    await expect(getSharedFileByToken(share!.shareToken)).rejects.toThrow(/File not found/);
  });
});

describe("file share links follow the current version (Google-Drive-style permanent links)", () => {
  // Regression test for the actual bug this refactor fixed: createFileShare
  // used to bake a real, static presigned S3 URL into the FileShare row at
  // creation time, so uploading a new version left the link serving the old
  // bytes forever. It should now always be a same-origin proxy URL that
  // resolves the file's *current* version fresh on every access — same
  // behavior the Telegram branch already had.
  it("the same share link serves a newly-uploaded version's content, without minting a new link", async () => {
    const user = await User.create({ email: "versioned-share@example.com", name: "Owner", provider: "test" });
    const file = await File.create({
      filename: "report.pdf", hash: "hash-v1", owner_email: user.email, owner_id: user._id,
      storageUrl: "uploads/owner/report-v1.pdf", backend: "s3", status: "uploaded", size: 1000,
    });
    const v1 = await FileVersion.create({
      file_id: file._id, version: 1, backend: "s3", storageUrl: "uploads/owner/report-v1.pdf",
      hash: "hash-v1", size: 1000, mimetype: "application/pdf", createdBy: user._id,
    });
    await File.findByIdAndUpdate(file._id, { currentVersionId: v1._id });

    const { shareUrl } = await createFileShare(user._id.toString(), file._id.toString());
    // Never a raw S3 URL — always the same-origin proxy path.
    expect(shareUrl).toMatch(/\/api\/share\/file\//);
    const token = shareUrl.split("/").pop()!;

    const before = await getSharedFileByToken(token);
    expect(before.kind).toBe("redirect");
    if (before.kind === "redirect") expect(before.url).toBe("https://s3.example/uploads/owner/report-v1.pdf");
    expect(createS3DownloadUrlMock).toHaveBeenLastCalledWith(
      "uploads/owner/report-v1.pdf", "report.pdf", "application/pdf", "inline"
    );

    // Upload a new version — no new share created, matching how the real
    // upload-completion routes never touch FileShare at all.
    const v2 = await FileVersion.create({
      file_id: file._id, version: 2, backend: "s3", storageUrl: "uploads/owner/report-v2.pdf",
      hash: "hash-v2", size: 2000, mimetype: "application/pdf", createdBy: user._id,
    });
    await File.findByIdAndUpdate(file._id, { currentVersionId: v2._id, hash: "hash-v2", size: 2000, storageUrl: "uploads/owner/report-v2.pdf" });

    // The exact same token/link now resolves the new content.
    const after = await getSharedFileByToken(token);
    expect(after.kind).toBe("redirect");
    if (after.kind === "redirect") expect(after.url).toBe("https://s3.example/uploads/owner/report-v2.pdf");

    // Still exactly one FileShare row — versioning never mints a new link.
    expect(await FileShare.countDocuments({ fileId: file._id.toString() })).toBe(1);
  });
});

describe("a share link cannot be used to read a different file via ?versionId=", () => {
  // Regression test for a real IDOR: getSharedFileByToken used to resolve
  // an explicit ?versionId with a bare FileVersion.findById(versionId), with
  // no check that the version actually belonged to the file this share
  // token is for. Anyone holding any one valid share link could swap in a
  // different, guessed/enumerated FileVersion _id — belonging to an
  // entirely different, unshared, possibly-another-owner's file — and have
  // it served through their own valid token.
  it("rejects a versionId belonging to an unrelated file, even though the token itself is valid", async () => {
    const owner = await User.create({ email: "share-owner@example.com", name: "Owner", provider: "test" });
    const sharedFile = await File.create({
      filename: "shared.pdf", hash: "shared-hash", owner_email: owner.email, owner_id: owner._id,
      storageUrl: "uploads/owner/shared.pdf", backend: "s3", status: "uploaded", size: 500,
    });
    const sharedVersion = await FileVersion.create({
      file_id: sharedFile._id, version: 1, backend: "s3", storageUrl: "uploads/owner/shared.pdf",
      hash: "shared-hash", size: 500, mimetype: "application/pdf", createdBy: owner._id,
    });
    await File.findByIdAndUpdate(sharedFile._id, { currentVersionId: sharedVersion._id });

    const victim = await User.create({ email: "victim@example.com", name: "Victim", provider: "test" });
    const victimFile = await File.create({
      filename: "private-tax-return.pdf", hash: "victim-hash", owner_email: victim.email, owner_id: victim._id,
      storageUrl: "uploads/victim/private-tax-return.pdf", backend: "s3", status: "uploaded", size: 9999,
    });
    const victimVersion = await FileVersion.create({
      file_id: victimFile._id, version: 1, backend: "s3", storageUrl: "uploads/victim/private-tax-return.pdf",
      hash: "victim-hash", size: 9999, mimetype: "application/pdf", createdBy: victim._id,
    });

    const { shareUrl } = await createFileShare(owner._id.toString(), sharedFile._id.toString());
    const token = shareUrl.split("/").pop()!;

    // The legitimate version resolves fine.
    const legit = await getSharedFileByToken(token, sharedVersion._id.toString());
    expect(legit.kind).toBe("redirect");
    if (legit.kind === "redirect") expect(legit.url).toBe("https://s3.example/uploads/owner/shared.pdf");

    // Swapping in another user's completely unrelated FileVersion _id must
    // not resolve — never the victim's storageUrl, never a 200/redirect.
    await expect(getSharedFileByToken(token, victimVersion._id.toString())).rejects.toThrow(/Version not found/);
    expect(createS3DownloadUrlMock).not.toHaveBeenCalledWith(
      "uploads/victim/private-tax-return.pdf", expect.anything(), expect.anything(), expect.anything()
    );
  });
});
