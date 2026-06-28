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
- [ ] Add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_BOT_API_URL` to `.env`
- [ ] Set up the Telegram Bot API server (`telegram-bot-api/`)
- [ ] Create a private Telegram channel for storage
- [ ] Test end-to-end upload + download

---

## Architecture

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
  └── file.backend === "s3" → GET S3 CDN URL → download
```

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
| — | S3 fallback | ✅ Automatic when Telegram init fails |

## File Manifest

### New / Modified Files
| File | Changes |
|------|---------|
| `lib/telegram.ts` | Accepts `Blob` directly (no Buffer) |
| `models/File.ts` | Added `backend`, `totalChunks`, `chunkSize` |
| `models/TelegramChunk.ts` | Changed `ref` from `TelegramFile` to `File` |
| `models/index.ts` | Removed `TelegramFile` export |
| `app/api/files/telegram/init/route.ts` | Uses `File` model |
| `app/api/files/telegram/chunk/route.ts` | Uses `File` model, zero-copy Blob |
| `app/api/files/telegram/complete/route.ts` | Uses `File` model |
| `app/api/files/telegram/cancel/route.ts` | Uses `File` model |
| `app/api/files/telegram/[fileId]/download/route.ts` | Uses `File` model, `ReadableStream` |
| `app/api/files/telegram/[fileId]/resume/route.ts` | Uses `File` model |
| `components/ui/fileupload.tsx` | Default telegram, S3 fallback, backend-aware download/open |

### Unused (kept as backup)
| File | Reason |
|------|--------|
| `models/TelegramFile.ts` | No longer imported, kept in case of revert |

## Environment Variables Needed
```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHANNEL_ID=@your_channel_id_or_-100...
TELEGRAM_BOT_API_URL=http://localhost:8081
```

## Next Steps (for future session)
1. Add the 3 env vars to `.env`
2. Build the Telegram Bot API server: follow `telegram-bot-api/build.html`
3. Create a private Telegram channel, add the bot as admin
4. Run `npx next dev` — toggle should default to Telegram
5. Upload a file → check it appears in the file list
6. Verify download works (both "Open" and "Download" buttons)
7. Test cancel mid-upload
8. Test browser-refresh resume
9. Kill the Telegram Bot API server → upload → verify it falls back to S3
