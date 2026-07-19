// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUpload } from "./useUpload";

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@/client/lib/uploadQueueDB", () => ({
  storeQueueItem: vi.fn().mockResolvedValue(undefined),
  removeQueueItem: vi.fn().mockResolvedValue(undefined),
  getAllQueueItems: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/client/lib/indexedDB", () => ({
  storeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/client/lib/telegramWorker", () => ({
  resumeTelegramUpload: vi.fn(),
}));

const PART_SIZE = 10 * 1024 * 1024;
const FILE_SIZE = PART_SIZE + 2 * 1024 * 1024; // forces 2 S3 fallback parts

function bigFile(name = "movie.mkv") {
  return new File([new Uint8Array(FILE_SIZE)], name, { type: "video/x-matroska" });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("useUpload S3 fallback flow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function routeFetch(handlers: Record<string, (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>>) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      for (const [match, handler] of Object.entries(handlers)) {
        if (url.includes(match)) return handler(input, init);
      }
      throw new Error(`Unhandled fetch: ${init?.method ?? "GET"} ${url}`);
    });
  }

  it("falls back to S3 after Telegram chunk upload fails and reaches 100% success", async () => {
    let chunkAttempts = 0;
    let putCalls = 0;

    routeFetch({
      "/api/files/telegram/init": () => jsonResponse({ fileId: "file-1", totalChunks: 1, chunkSize: FILE_SIZE }),
      "/api/files/telegram/chunk": () => {
        chunkAttempts++;
        return jsonResponse({ error: "Upload failed", canFallbackToS3: true }, 503);
      },
      "/api/files/file-1/fallback-to-s3": () => jsonResponse({ fileId: "file-1", backend: "s3", status: "s3_pending", key: "uploads/x" }),
      "/api/files/fallback-to-s3/init": () => jsonResponse({ uploadId: "up-1", key: "uploads/x", totalParts: 2 }),
      "/api/files/upload/multipart/presign": () => jsonResponse({ urls: ["https://s3.example/part1", "https://s3.example/part2"] }),
      "https://s3.example/part": () => {
        putCalls++;
        return new Response(null, { status: 200, headers: { ETag: `"etag-${putCalls}"` } });
      },
      "/api/files/upload/multipart/complete": () => jsonResponse({}),
      "/api/dashboard": () => jsonResponse({ pendingFiles: [] }),
    });

    const { result } = renderHook(() => useUpload(null));

    await act(async () => {
      await result.current.handleFile(bigFile());
    });

    await waitFor(() => {
      expect(result.current.uploads[0]?.status).toBe("success");
    });

    expect(result.current.uploads[0].progress).toBe(100);
    expect(chunkAttempts).toBeGreaterThan(0);
    expect(putCalls).toBe(2);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  }, 15000);

  it("clears upload metadata after a failed S3 fallback so a later resume click is a no-op instead of retrying dead Telegram chunks", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    routeFetch({
      "/api/files/telegram/init": () => jsonResponse({ fileId: "file-2", totalChunks: 1, chunkSize: FILE_SIZE }),
      "/api/files/telegram/chunk": () => jsonResponse({ error: "Upload failed", canFallbackToS3: true }, 503),
      "/api/files/file-2/fallback-to-s3": () => jsonResponse({ fileId: "file-2", backend: "s3", status: "s3_pending", key: "uploads/x" }),
      "/api/files/fallback-to-s3/init": () => jsonResponse({ uploadId: "up-2", key: "uploads/x", totalParts: 2 }),
      "/api/files/upload/multipart/presign": () => jsonResponse({ urls: ["https://s3.example/part1", "https://s3.example/part2"] }),
      // Every part PUT fails, exhausting fallbackToS3's own 3-attempt retry
      // and making the whole fallback throw.
      "https://s3.example/part": () => new Response("nope", { status: 500 }),
    });

    const { result } = renderHook(() => useUpload(null));

    const handleFilePromise = act(async () => {
      await result.current.handleFile(bigFile());
    });
    // Flush the two backoff sleeps (1s, 2s) inside fallbackToS3's per-part retry loop.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await handleFilePromise;

    expect(result.current.uploads[0]?.status).toBe("error");

    const fetchCallsBeforeResume = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.resumeSingleUpload(result.current.uploads[0].id);
    });
    // uploadMeta was cleared on the failed-fallback path, so resumeSingleUpload's
    // `if (!meta) return;` guard fires immediately — no further network calls
    // (in particular, no doomed /api/files/telegram/chunk request against a
    // file whose backend the server already switched to s3).
    expect(fetchMock.mock.calls.length).toBe(fetchCallsBeforeResume);

    vi.useRealTimers();
  }, 15000);
});
