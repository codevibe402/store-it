// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

import { createFileShare, getSharedFileByToken } from "./shareService";
import File from "@/adapters/database/models/File";
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
});

describe("file share links are revoked by deleting the file", () => {
  // Telegram-backend shares resolve through getSharedFileByToken's own fresh
  // File lookup on every access — that's the path server/services/
  // shareService.ts's `deleted: { $ne: true }` fix applies to. (S3-backend
  // shares hand out a long-lived AWS presigned URL up front instead, which
  // is a self-contained credential AWS itself validates — soft-deleting the
  // File row can't revoke one already issued; only removing the S3 object
  // via hardDeleteFile does. That's a separate, structural limitation of
  // presigned URLs, not something a query filter can fix, and is out of
  // scope here.)
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
    expect(share!.backend).toBe("telegram");

    // Works before delete (throws for a different, expected reason — no
    // FileVersion exists in this minimal fixture — proving the lookup got
    // past the file-existence check).
    await expect(getSharedFileByToken(share!.shareToken)).rejects.toThrow(/Version not found/);

    // Soft-delete the file (recycle bin), same as a normal user-initiated delete.
    await File.findByIdAndUpdate(file._id, { deleted: true, deletedAt: new Date() });

    await expect(getSharedFileByToken(share!.shareToken)).rejects.toThrow(/File not found/);
  });
});
