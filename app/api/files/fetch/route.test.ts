// @vitest-environment node
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTestDB, disconnectTestDB, clearTestDB } from "@/tests/helpers/testDb";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

import { getAuthUser } from "@/server/auth/auth";
import { GET } from "./route";
import File from "@/adapters/database/models/File";

const mockGetAuthUser = vi.mocked(getAuthUser);

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

describe("GET /api/files/fetch", () => {
  // Regression test: this route used to have no `deleted` filter at all
  // (unlike /api/dashboard, which did), so a file the user had already
  // moved to the recycle bin kept showing up here — this endpoint backs the
  // sidebar file browser (app/sidebar/page.tsx), so a "deleted" file stayed
  // fully visible and clickable outside the main dashboard view.
  it("excludes soft-deleted files from the results", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u1", email: "sidebar@example.com", provider: "test", storageused: 0, storagelimit: 1 });

    const live = await File.create({
      filename: "keep.txt", hash: "h1", owner_email: "sidebar@example.com", owner_id: "000000000000000000000001",
      storageUrl: "s3/keep.txt", backend: "s3", status: "uploaded", size: 10,
    });
    await File.create({
      filename: "trashed.txt", hash: "h2", owner_email: "sidebar@example.com", owner_id: "000000000000000000000001",
      storageUrl: "s3/trashed.txt", backend: "s3", status: "uploaded", size: 10,
      deleted: true, deletedAt: new Date(),
    });

    const res = await GET(new NextRequest("http://localhost/api/files/fetch"));
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ _id: string }>;
    expect(body.map((f) => f._id)).toEqual([live._id.toString()]);
  });
});
