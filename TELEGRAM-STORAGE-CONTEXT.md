# Telegram Storage Implementation Context

## Status Overview
- [x] Context tracking file created
- [x] `lib/telegram.ts` — Telegram Bot API client (zero-copy Blob streaming)
- [x] `models/File.ts` — Unified model: added `backend`, `totalChunks`, `chunkSize`
- [x] `models/TelegramChunk.ts` — References `File` (was `TelegramFile`)
- [x] `models/TelegramFile.ts` — Removed from index (no longer needed)
- [x] `POST /api/files/telegram/init` — Creates `File` record with `backend: "telegram"`
- [x] `POST /api/files/telegram/chunk` — Upload + retry/backoff + compensation
- [x] `POST /api/files/telegram/complete` — Verifies all chunks, marks uploaded
- [x] `POST /api/files/telegram/cancel` — Cleanup (delete Telegram messages + DB)
- [x] `GET /api/files/telegram/[fileId]/download` — Streamed reconstruction with hash verify
- [x] `GET /api/files/telegram/[fileId]/resume` — Resume/browser refresh support
- [x] Frontend: `telegramUpload()` with 3-worker queue, `AbortController`, per-chunk retry
- [x] Frontend: Telegram primary (default toggle), S3 fallback on init failure
- [x] Frontend: `openFile()` / `downloadFile()` backend-aware (S3 vs Telegram)
- [x] Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_BOT_API_URL` to `.env`
- [x] Set up the Telegram Bot API server (`telegram-bot-api/`)
- [x] Create a private Telegram channel for storage
- [ ] Test end-to-end upload + download

### S3 Fallback Implementation (July 2026)
- [x] `models/File.ts` — Extended status enum: `pending`, `uploading`, `paused`, `fallback_cleanup`, `s3_pending`, `uploaded`, `cancelled`, `failed`
- [x] `models/File.ts` — Added fields: `lastError`, `fallbackFrom`, `fallbackReason`, `fallbackStartedAt`, `fallbackCompletedAt`, `cleanupWarnings`
- [x] `POST /api/files/telegram/chunk` — Rejects chunks if `backend !== "telegram"` or status not in `["pending","uploading","paused"]`; sets status `uploading` on first chunk; marks `paused` with `lastError` on total failure; returns `503` with `canFallbackToS3: true`
- [x] `POST /api/files/[id]/fallback-to-s3` — Atomic `findOneAndUpdate` with status guard; deletes Telegram messages (best-effort); removes `TelegramChunk` records; converts same `File` doc to `s3_pending` with S3 key
- [x] `POST /api/files/telegram/complete` — Rejects if `backend !== "telegram"`; atomic storage increment (prevents double-count)
- [x] `GET /api/files/telegram/[fileId]/download` — Rejects if `backend !== "telegram"`
- [x] `GET /api/files/telegram/[fileId]/resume` — Returns `canResumeTelegram: false` + `canFallbackToS3` for non-telegram files
- [x] `POST /api/files/upload` (S3 small) — Accepts `fileId` param; updates existing `s3_pending` file record instead of creating new one; hash verification
- [x] `POST /api/files/upload/multipart/init` (S3 multipart) — Accepts `fileId` param; reuses existing `s3_pending` file's `storageUrl`; skips duplicate & storage checks for fallback
- [x] `GET /api/files/fetch` — Accepts comma-separated status values (e.g. `?status=pending,uploading,paused`)
- [x] Frontend `telegramUpload()` — Catches `canFallbackToS3` from chunk 503; aborts all workers; calls `POST /fallback-to-s3`; uploads original browser File to S3 via `s3FallbackUpload()`
- [x] Frontend `s3FallbackUpload()` — Uploads to S3 small or multipart with existing `fileId`, hash verification
- [x] Frontend `pendingFiles` query — Fetches statuses `pending,uploading,paused,fallback_cleanup,s3_pending`
- [x] Frontend `FileType` — Updated `status` union type with all new states

---

## Architecture

### File Versioning & Sharing Domain Architecture

```
┌─────────────────────────────────────────────────────┐
│                    DOMAIN LAYER                       │
│                                                       │
│  File              FileVersion      FolderShare       │
│  ──────────        ─────────────    ────────────      │
│  filename          file_id          token             │
│  owner_id          version          tokenHash         │
│  folderId          backend          folderId          │
│  currentVersionId──► storageUrl     owner_id          │
│  backend            hash            permission        │
│  storageUrl         size            expiresAt         │
│  hash               mimetype        revokedAt         │
│  size               status         maxDownloads       │
│  mimetype           createdBy       downloadCount     │
│  status             uploadedAt      allowVersionHistory│
│  ──────────        ─────────────    ────────────      │
│  current pointer    immutable       permission-only    │
│                     history         no stored URLs    │
│                                                       │
│  TelegramChunk                                        │
│  ─────────────                                        │
│  fileId, versionId, chunkIndex                        │
│  telegramMessageId, telegramFileId, hash, size        │
│  ─────────────                                        │
│  chunks tied to version, not just file                │
└───────────────────────────────────────────────────────┘

Download Abstraction (lib/download.ts):
  createS3DownloadUrl(storageUrl, filename, mimetype)
  createS3PresignedUrl(storageUrl, filename, mimetype, expiresIn)
  createTelegramDownloadStream(versionId, totalSize, mimetype, filename)
  createVersionDownloadResponse(fileId, versionId?)
```

### Versioning Flow
```
New file upload:
  File.create() → FileVersion v1 created → File.currentVersionId = v1._id

Same name in same folder (new version):
  Find File by (filename + owner_id + folderId)
  FileVersion v2 created → File updated: storageUrl, hash, size, currentVersionId = v2._id

Restore version:
  File.currentVersionId = selectedVersion._id
  File.storageUrl = selectedVersion.storageUrl
  File.hash = selectedVersion.hash
  File.size = selectedVersion.size
  (No data copy — pointer only)

Delete version:
  FileVersion.status = "deleted" (soft delete)
```

### Unified File Model
```
File {
  backend: "s3" | "telegram"     ← new
  totalChunks: Number             ← new (telegram only)
  chunkSize: Number               ← new (telegram only)
  storageUrl: String              ← S3 key or telegram identifier
  status: "pending" | "uploaded"
  hash, filename, size, ...       ← existing
}
```

### Upload Flow (Telegram Primary, S3 Fallback)
```
Frontend (default: "telegram")
  │
  ├── Telegram init → success? → upload chunks via queue (3 workers)
  │                              → complete → file in list (backend: "telegram")
  │
  └── Telegram init → fail? → fall back to S3 multipart (transparent)
                               → file in list (backend: "s3")
```

### Download Flow
```
Frontend: downloadFile(file)
  │
  ├── file.backend === "telegram" → GET /api/files/telegram/[id]/download
  │                                  → stream chunks (verify hash each) → concat
  │
  └── file.backend === "s3" → GET /api/files/[id]/download
                               → createS3DownloadUrl() → redirect

Share downloads:
  GET /api/share/folder/[token]/files/[fileId]/download
    → validates token, checks expiry/revocation/download limit
    → loads file, checks folderId + owner_id match
    → backend-aware: S3 redirect or Telegram stream
    → increments downloadCount
```

### Folder Sharing Architecture
```
Share create (POST /api/folders/[id]/share):
  Validates ownership
  Generates token + tokenHash
  Stores: folderId, permission, expiresAt (NO file URLs)
  Returns shareUrl

Share view (GET /api/share/folder/[token]/folders):
  Validates token (not expired, not revoked)
  Loads files LIVE from File model by folderId + owner_id + status="uploaded"
  Returns metadata + download URLs per file

Share download (GET /api/share/folder/[token]/files/[fileId]/download):
  Validates token
  Validates file ownership + folder membership
  Checks download limits
  Increments downloadCount
  Routes to S3 redirect or Telegram stream based on file.backend

Benefits:
  - New files added to folder appear automatically
  - Revocation is real (token checked on every access)
  - Download limits enforceable
  - No expired presigned URLs distributed
  - Both backends work via one system
```

## State Machine

```
telegram pending ──→ uploading ──→ uploaded        (normal Telegram upload)
                      │
                      └──→ paused                   (chunk failure after retries)
                            │
                            └──→ fallback_cleanup    (user triggers S3 fallback)
                                  │
                                  └──→ s3_pending    (cleanup done, S3 key assigned)
                                        │
                                        └──→ uploaded  (S3 upload complete)
                                              or
                                        └──→ cancelled (user cancels)

Any telegram state → cancelled (user explicit cancel)
```

**Rules:**
- One final backend per file (never split across Telegram + S3)
- Partial Telegram chunks are always cleaned up during fallback
- Late chunks rejected server-side after backend changes
- Storage quota incremented exactly once: `non-uploaded → uploaded`
- Version only created after final S3 upload (not during Telegram init)
- Download routes route by `file.backend`, not by file ID

## ChatGPT Suggestion Compliance

| # | Suggestion | Status |
|---|-----------|--------|
| 1 | Out-of-order via chunkIndex | ✅ `sort(chunkIndex)` on download |
| 2 | Resume from failed chunk | ✅ Resume endpoint returns missing indexes |
| 3 | Duplicate via hash | ✅ `init` checks `File` for existing hash |
| 4 | Unique index on (fileId, chunkIndex) | ✅ Mongoose unique compound index |
| 5 | Track uploaded bytes | ✅ `sum(chunkSize) / totalSize` |
| 6 | Concurrency queue (not Promise.all) | ✅ 3 workers, atomic index grab |
| 7 | Exponential backoff on 429 | ✅ 1s → 2s → 4s |
| 8 | Resume on browser refresh | ✅ `/resume` endpoint |
| 9 | Limited workers (3) | ✅ `TELEGRAM_CONCURRENCY = 3` |
| 10 | Compensation on DB failure | ✅ Deletes Telegram msg if Mongo fails |
| 11 | Progress only on server confirm | ✅ Incremented after 200 response |
| 12 | SHA-256 verify on download | ✅ Each chunk verified before concat |
| 13 | Worker catches exception | ✅ try/catch, retry, picks next chunk |
| 14 | AbortController | ✅ Cancels in-flight HTTP requests |
| 15 | Sort by chunkIndex on reconstruct | ✅ `find().sort({ chunkIndex: 1 })` |
| — | Zero-copy streaming (upload) | ✅ Blob passed directly, no Buffer copy |
| — | Streamed download (memory-safe) | ✅ `ReadableStream`, 30MB max memory |
| — | S3 fallback on init failure | ✅ Automatic when Telegram init fails |
| — | S3 fallback on chunk failure | ✅ Stateful: `paused` → `fallback_cleanup` → `s3_pending` → `uploaded` |
| — | Late chunk rejection | ✅ `/telegram/chunk` rejects if backend changed or status invalid |
| — | Atomic fallback route | ✅ `findOneAndUpdate` with status guard prevents race conditions |
| — | Storage counted once | ✅ Only incremented on `non-uploaded → uploaded` transition |
| — | Hash verification on fallback | ✅ Frontend hash match check before S3 fallback |
| — | Resume-aware fallback info | ✅ `/resume` returns `canResumeTelegram`, `canFallbackToS3` |
| — | Telegram message cleanup | ✅ Best-effort delete + DB cleanup in fallback route |
| — | Fallback audit trail | ✅ `lastError`, `fallbackReason`, `fallbackStartedAt`, `fallbackCompletedAt`, `cleanupWarnings` |

## File Manifest

### New / Modified Files
| File | Changes |
|------|---------|
| `lib/telegram.ts` | Accepts `Blob` directly (no Buffer) |
| `lib/download.ts` | **NEW** — Unified download abstraction: `createS3DownloadUrl`, `createTelegramDownloadStream`, `createVersionDownloadResponse` |
| `models/File.ts` | Added `currentVersionId`; extended status enum + fallback fields |
| `models/FileVersion.ts` | Expanded: `backend`, `storageUrl`, `hash`, `size`, `mimetype`, `status`, `createdBy` |
| `models/TelegramChunk.ts` | Added `versionId` field, index on `(versionId, chunkIndex)` |
| `models/Foldershare.ts` | Removed `files` array, added `tokenHash`, `revokedAt`, `maxDownloads`, `downloadCount`, `allowVersionHistory` |
| `models/index.ts` | Exports `FolderShare`, `FileShare` |
| `app/api/files/upload/route.ts` | Proper versioning: creates FileVersion v1 with full metadata; version on same-name upload; sets `currentVersionId` |
| `app/api/files/upload/multipart/complete/route.ts` | Creates FileVersion + sets `currentVersionId`; version-on-name-conflict for multipart |
| `app/api/files/telegram/complete/route.ts` | Creates FileVersion v1 + backfills `versionId` on TelegramChunks |
| `app/api/files/telegram/[fileId]/download/route.ts` | Rejects non-telegram backend |
| `app/api/files/[id]/download/route.ts` | Backend-aware: uses `createS3DownloadUrl` for S3, streams Telegram via version |
| `app/api/files/[id]/versions/route.ts` | Uses `currentVersionId` for isCurrent; returns backend/hash/size per version |
| `app/api/folders/[id]/share/route.ts` | No longer stores file URLs; stores permission-only record with `tokenHash` |
| `app/api/share/folder/[token]/folders/route.ts` | GET returns live file list from DB; POST creates subfolder |
| `app/api/share/folder/[token]/upload/route.ts` | Proper versioning for shared uploads |
| `app/api/share/folder/[token]/files/[fileId]/download/route.ts` | **NEW** — Token-validated, backend-aware file download for shares |
| `app/share/folder/[token]/page.tsx` | Loads files live from API; no embedded stale data |

### Unused (kept as backup)
| File | Reason |
|------|--------|
| `models/TelegramFile.ts` | No longer imported, kept in case of revert |

## Environment Variables
```
TELEGRAM_BOT_TOKEN=8659935195:AAFufGbvSX_bCj0vYqCAoH_pxgTuR9n5Cq0
TELEGRAM_CHANNEL_ID=-1003920055093
TELEGRAM_BOT_API_URL=https://api.telegram.org   (or http://localhost:8081 for local server)
```

## Test Order (S3 Fallback)
Test in this exact order:
1. Normal Telegram upload succeeds
2. Normal S3 upload succeeds (small + multipart)
3. Telegram chunk fails once, retry succeeds
4. Telegram chunk fails after all retries → file becomes `paused`
5. Client calls `POST /fallback-to-s3` → partial Telegram chunks deleted → file becomes `s3_pending`
6. S3 fallback upload succeeds → same file record becomes `backend: "s3"`, `status: "uploaded"`
7. Storage quota increments exactly once
8. Telegram download endpoint returns `409` for fallback file
9. Generic/S3 download works for fallback file
10. Resume route says `canResumeTelegram: false` for fallback file
11. Browser refresh during `paused` state → user must reselect original file
12. Late Telegram chunk worker → rejected by chunk route (409)
13. Cancel mid-upload → cleanup works
14. Kill Telegram Bot API → upload → verify S3 fallback works end-to-end
