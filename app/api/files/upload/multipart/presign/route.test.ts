// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/auth/auth", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/adapters/storage/s3", () => ({
  s3: {},
  BUCKET: "test-bucket",
}));

const getSignedUrlMock = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

import { getAuthUser } from "@/server/auth/auth";
import { POST } from "./route";

const mockGetAuthUser = vi.mocked(getAuthUser);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/files/upload/multipart/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/files/upload/multipart/presign", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ key: "k", uploadId: "u", partNumbers: [1] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({ key: "k" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when partNumbers is empty", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    const res = await POST(makeRequest({ key: "k", uploadId: "u", partNumbers: [] }));
    expect(res.status).toBe(400);
  });

  it("returns one presigned URL per part number, in order", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    getSignedUrlMock.mockImplementation(async (_client, command) => `https://s3.example/${command.input.PartNumber}`);

    const res = await POST(makeRequest({ key: "k", uploadId: "u", partNumbers: [1, 2, 3] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.urls).toEqual([
      "https://s3.example/1",
      "https://s3.example/2",
      "https://s3.example/3",
    ]);
    expect(getSignedUrlMock).toHaveBeenCalledTimes(3);
  });

  it("returns 500 (not an unhandled crash) when presigning fails", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u", email: "a@b.com", provider: "test", storageused: 0, storagelimit: 1 });
    getSignedUrlMock.mockRejectedValue(new Error("KMS unavailable"));

    const res = await POST(makeRequest({ key: "k", uploadId: "u", partNumbers: [1] }));
    expect(res.status).toBe(500);
  });
});
