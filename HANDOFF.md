# Session Handoff — StoreIt

Summary of everything investigated, broken, and fixed in this session. Organized by feature area, each with: the problem, the root cause, and what was actually changed. An "Open / Unresolved" section at the end lists things flagged but not finished.

---

## 1. Upload resume-after-refresh

**Problem:** After pausing a large (Telegram-backed) upload and refreshing the browser, clicking "Resume" always forced the user to reselect the file from disk instead of continuing automatically.

**Root causes found (three, stacked):**
1. `hooks/useResume.ts`'s `startResume()` checked in-memory caches (always empty after a refresh), then immediately opened a file picker — the IndexedDB lookup that could recover the file across a refresh ran *after* the picker, i.e. dead code for the exact scenario it existed for.
2. The file handle was never persisted where `useResume` actually looked for it. `hooks/useUpload.ts` only wrote it into a different IndexedDB store (`uploadQueueDB.ts`, keyed by a client-side id), not the one `useResume` reads (`client/lib/indexedDB.ts`, keyed by server `fileId`).
3. **The real blocker:** the user's browser doesn't support the File System Access API (`showOpenFilePicker`) at all. Confirmed via console logging — `typeof showOpenFilePicker === "function"` was `false`. No handle could ever be captured or reopened silently in this environment, and this is true for Firefox/Safari generally, not just this one browser/profile.

**Fix:**
- Stopped relying on `FileSystemFileHandle` as the primary recovery mechanism. `UploadRecord` (`client/lib/indexedDB.ts`) now supports an optional `blob: Blob` field alongside the optional `handle`.
- `hooks/useUpload.ts` persists the actual file content as a Blob (via IndexedDB, which backs large Blobs with disk, not memory) when no handle is available; prefers a handle when one exists (cheaper).
- `hooks/useResume.ts`'s `startResume()` now checks IndexedDB (by `fileId`, then by `filename|size`) **before** ever falling back to the picker, and reconstructs a `File` directly from a stored blob with no permission prompt needed.
- `components/ui/fileupload.tsx`: click-to-browse now tries `showOpenFilePicker()` first (to get a handle when available) and falls back to the plain `<input type="file">` otherwise.

**Side effect fixed along the way:** `client/lib/indexedDB.ts` and `client/lib/uploadQueueDB.ts` share one physical IndexedDB database (`StoreItResume`) but had drifted to different `DB_VERSION` numbers (2 vs 3). Storing the blob more often surfaced a `VersionError: requested version (2) is less than existing version (3)`. Fixed by syncing both to `DB_VERSION = 3` and having each module's `onupgradeneeded` create both stores, so whichever module opens the DB first performs a correct upgrade.

---

## 2. Pause causing `ECONNRESET` / `Error: aborted` spam

**Problem:** Pausing an in-progress resume produced bursts of `⨯ Error: aborted (ECONNRESET)` in the server log.

**Root cause:** `client/lib/telegramWorker.ts`'s `resumeTelegramUpload()` shares **one `AbortController`** across all 6 concurrent chunk-upload workers. Both `hooks/useResume.ts`'s `pauseSingleResume()` and the function's own error-handling `catch` block called `controller.abort()` on pause — killing every in-flight chunk request at once, including ones mid-transfer or awaiting a response, not just future ones. Compare to `hooks/useUpload.ts`'s (non-resume) pause, which never aborts — it just sets a flag the loop checks between chunks, letting in-flight requests finish.

**Fix:**
- `telegramWorker.ts`: workers now check `pauseRef.current` only before starting a *new* chunk (`return` gracefully); in-flight chunks finish naturally. `controller.abort()` in the outer catch now only fires for a genuine cancel or unrecoverable error, not a graceful pause. Removed an incorrect `cancelRef.current = true` that was firing even on plain pause.
- `hooks/useResume.ts`: `pauseSingleResume()` no longer calls `abortRef.current?.abort()`.
- `app/api/files/telegram/chunk/route.ts`: added a cheap `req.signal.aborted` guard right after reading the chunk body, before the expensive Telegram API call + DB write, so a genuine cancel doesn't waste a full chunk upload on a response nobody will read.

---

## 3. Recycle bin — folder delete didn't cascade

**Problem:** Deleting a folder only removed the `Folder` document. Files and subfolders inside it became orphaned — present in the DB, invisible in the UI, unreachable.

**Fix (fast client-visible removal + async background cascade):**
- `adapters/database/models/Folder.ts`: added `deleted`/`deletedAt` fields (soft delete, mirroring `File`).
- `server/services/folderService.ts`: replaced the old (unused) hard-delete `deleteFolder` with:
  - `softDeleteFolderFast()` — one cheap update, marks the folder deleted immediately.
  - `cascadeDeleteFolderContents()` — walks the folder tree level by level, marks every descendant folder deleted, and bulk soft-deletes every contained file across the whole subtree (moves them to the recycle bin, same as a normal single-file delete).
- `app/api/folders/[id]/route.ts`: `DELETE` calls the fast soft-delete, responds immediately, then schedules the cascade via Next's `after()` so it keeps running after the response is sent (the Vercel-safe way to background work — a bare fire-and-forget promise can get killed once the function returns).
- Every folder read path (`GET /api/folders`, `GET /api/folders/[id]`, `/api/dashboard`, `folderService.getFolders`, plus move/rename/share lookups in `fileService.ts`/`shareService.ts`) now filters `deleted: { $ne: true }`, so a folder mid-cascade never renders or can be targeted.
- `hooks/useFolders.ts`: `deleteFolder` mutation gained an optimistic `onMutate` that removes the folder and all descendants from the dashboard cache instantly, with rollback on error; invalidates the recycle-bin query on success.

**Follow-on bug found while testing this:** deleting a folder made it reappear in the UI seconds later. Root cause: `app/api/dashboard/route.ts` had `Cache-Control: private, max-age=15, stale-while-revalidate=30`. Any mutation that called `invalidateQueries(["dashboard"])` triggered a `fetch()` the browser could silently answer from its own 15s HTTP cache instead of hitting the server, resurrecting just-deleted data. **Fixed by changing it to `Cache-Control: private, no-store`** — TanStack Query already owns caching/staleness for this endpoint client-side; the HTTP-level cache was actively fighting it.

---

## 4. Logout button unreachable

**Problem:** `components/LogoutButton.tsx` existed and worked correctly (revokes refresh token, clears cookies, calls NextAuth `signOut`, redirects) but was only ever used inside `components/RightSidebar.tsx`, which was never imported anywhere. Dead UI.

**Fix:** Rendered `LogoutButton` directly in `app/dashboard/page.tsx`'s header (top-right, via the header's existing `justify-between` layout).

---

## 5. 3-dot menus — files had none, folders were incomplete

**Problem:** `FolderCard.tsx`'s 3-dot menu (Rename/Delete) worked correctly end-to-end, but files had no 3-dot menu at all — only inline Preview/Download buttons. Several already-built, already-working backend routes and dialogs (`ShareDialog`, `MoveDialog`, `VersionsDialog`, `DeleteDialog`, and `hooks/useFiles.ts`'s `openShareModal`/`openFolderShareModal`/`setMoveTarget`/`openVersions`/`deleteFile`) were fully implemented but never wired to any UI trigger.

**Fix:**
- Generalized `app/dashboard/page.tsx`'s `ctxMenuTarget` state from a folder-only shape to a `{type: "folder"|"file", item, element}` union, so one context-menu component serves both.
- Added a 3-dot (`MoreHorizontal` — was imported but unused) button to each file card, opening: **Share**, **Move**, **Version history**, **Delete**.
- Added **Share** to the folder's existing Rename/Delete menu.
- Removed a dead unused `openMenu` function found while doing this.

---

## 6. Zero-knowledge file encryption — full rebuild

**Problem (discovered while debugging a "preview shows hex garbage" report):** The app had a passphrase-based "zero-knowledge" encryption mode (a password-style field on the login form) where files were encrypted client-side before upload. **Client-side decryption on download/preview was never implemented** — `decryptFileChunks()` existed in `hooks/useFileEncryption.ts` but was never called anywhere. Any file uploaded with a passphrase would always show raw ciphertext in preview/download.

Further, the passphrase itself was a pure in-memory JS variable, cleared on every page reload, with **no recovery mechanism** — forgetting it (trivially easy, since it wasn't required and most users never noticed the field) meant permanent loss of access, and it only applied to email/password logins (the app also supports Google and Telegram login, which have no password to derive anything from).

**Design decision (discussed and agreed before building):** replace the passphrase field entirely with a device-persisted Data Encryption Key (DEK) + one-time recovery code, modeled on how Bitwarden/Proton/Signal handle this:
- A random DEK is generated once per account.
- It's persisted **unwrapped** in a per-device IndexedDB store (`client/lib/dekStore.ts`, new dedicated DB `StoreItKeys`) — so a known device unlocks silently on every future login, with zero typing, regardless of login provider (credentials, Google, or Telegram all work identically since none of this depends on a password).
- It's also wrapped (AES-GCM, via a PBKDF2-derived key) with a recovery code shown to the user **once**, at first login, and stored server-side only in that wrapped form.
- A new device (or cleared local storage) prompts for the recovery code once, unwraps the DEK, and persists it locally for that device going forward.
- A password reset has **zero effect** on file access, since nothing is tied to the password.

**What was built:**
- `client/lib/dek.ts` — DEK generation, recovery-code generation (Crockford base32), PBKDF2 wrap/unwrap.
- `client/lib/dekStore.ts` — per-device IndexedDB persistence of the raw DEK.
- `hooks/useFileEncryption.ts` — replaced the passphrase cache with a session DEK holder (`setSessionDEK`/`getSessionDEK`/`clearSessionDEK`); kept the underlying `deriveKey`/`encryptChunk`/`decryptChunk` primitives; exported the base64 helpers.
- `adapters/database/models/User.ts` — `encryptionRecoveryWrapped/Nonce/Salt/SetupAt` fields.
- `adapters/database/models/File.ts` — explicit `encryptionMode: 'dek' | 'server' | 'none'` field, replacing implicit inference from other fields.
- New routes: `GET /api/auth/encryption/status`, `POST /api/auth/encryption/setup` (one-time only), `GET /api/auth/encryption/recovery-wrap`.
- `app/api/files/telegram/init/route.ts` — new `useDek` mode alongside the existing server-managed/plain modes. The old passphrase-salt legacy branch was kept (so nothing mid-flight breaks) but is no longer produced by the client.
- `server/services/fileService.ts` — `getFileManifest()`/`getFileChunkData()` + two new routes (`GET /api/files/[id]/manifest`, `GET /api/files/[id]/chunk-data/[index]`) so the client can fetch per-chunk ciphertext + nonces and decrypt them itself. **This is the actual fix for the "hex garbage" bug.**
- `components/AuthProvider.tsx` — on every login (any provider), checks the device store first (silent unlock), then account status, then shows `EncryptionSetupModal` (first-ever login: generate DEK, show recovery code once, require confirmation) or `EncryptionRecoveryModal` (known account, new device: enter recovery code once).
- `components/Authform.tsx` — manual passphrase field removed entirely.
- `hooks/useUpload.ts` — uses the session DEK directly; falls back to server-managed encryption if the DEK isn't unlocked yet, so uploads are never blocked on it.
- `hooks/useFiles.ts` — `openFile`/`downloadFile` check the file's manifest first; only DEK-encrypted files take the fetch-chunks-and-decrypt path, everything else (S3, server-managed, unencrypted) is untouched.

**Caching added on top of the new endpoints:**
- `GET /api/files/[id]/chunk-data/[index]` — `Cache-Control: private, max-age=86400, immutable` (ciphertext per chunk never changes once uploaded).
- `GET /api/files/[id]/manifest` — same header (chunk list/nonces are immutable per version).
- (Earlier, same session) `server/lib/download.ts`'s `createTelegramDownloadStream()` — the non-DEK Telegram streaming path (server-managed encryption / no encryption) had **no caching at all**; every preview/download fully re-streamed from Telegram. Added the same `private, max-age=86400, immutable` header there too.

**Honest scope note:** files uploaded under the old, already-broken passphrase-based mode (before this session) remain undecryptable via the UI — they were never wired up before either, so this is unmigrated legacy debt, not a regression.

---

## Open / Unresolved

- **"Pending uploads" entry stays after upload finishes** — reported, investigation started but interrupted before a root cause was confirmed. Verified structurally correct: `/complete` sets `status: "uploaded"`, `/api/dashboard` correctly filters by status, `Cache-Control: no-store` is confirmed still in place (not a regression of the fix in §3). Two questions were queued but not yet answered: (a) does a hard refresh clear the stuck entry (client-cache/re-render bug) or does it persist (server-side `/complete` never actually succeeded — e.g. a chunk-count mismatch), and (b) is it specifically the "Pending uploads" section or the separate "Uploads" progress list (which *by design* keeps a "success" row visible until manually dismissed — that's expected behavior, not a bug, and may be what's being observed). **Needs the user's answer to those two questions to proceed.**
- **Preview slow / caching investigation** — mid-investigation when redirected to other work. Confirmed: the specific file being tested isn't DEK-encrypted, so `openFile()` correctly falls through to the plain `/download?preview=1` route (not a routing bug). An unexplained `vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` header was observed on API route responses that shouldn't emit it — suspected to be a Next.js/Turbopack dev-server quirk (that header is normally App Router page-navigation machinery, not something Route Handlers emit). Not yet confirmed whether this is actually interfering with `Cache-Control` handling, or just noise. **Recommended next step:** test the same repeat-preview flow against a production build (`next build && next start`) rather than `next dev`, since dev servers commonly special-case caching/response headers in ways production doesn't.
- **`ShareDialog.tsx`'s `onGenerateFileShare`/`onGenerateFolderShare` props are unused inside the component** — the new Share menu items (§5) call `openShareModal`/`openFolderShareModal` directly instead (which already both set the target and fetch the URL in one step, so this works correctly), but the dialog itself has no "Generate" button that would use those two props. Harmless dead props, not fixed — flagging for awareness.
- **`/api/schedules/due`** — was seen 404ing repeatedly and frequently in dev server logs throughout the session. Exhaustively searched (full repo grep, `middleware.ts`, `next.config.*`, `package.json`, `public/`) — **no reference to this path exists anywhere in the codebase.** Concluded it's external to the app (browser extension, dev tool, or another local process polling `localhost:3000`), not a bug to fix here.
- **Duplicate upload display (pre-existing, not caused by this session's changes):** while a file is actively uploading, it can appear simultaneously in both the "Uploads" section (client-side progress list) and the "Pending uploads" section (server-driven, since the file's DB status is `pending`/`uploading` the moment `/init` succeeds). `visiblePendingFiles` in `components/ui/fileupload.tsx` doesn't currently exclude files already present in `uploadHook.uploads`. Noted but not fixed this session.
- **Two parallel resume implementations** (noted early in the session, not consolidated): `hooks/useUpload.ts`'s own serial chunk-loop vs. `client/lib/telegramWorker.ts`'s 6-worker pool, and two separate IndexedDB modules (`uploadQueueDB.ts` vs `indexedDB.ts`) doing overlapping jobs with different schemas. Both were touched/fixed for the specific bugs in §1/§2 but not architecturally merged.

---

## Verification performed

- `npx tsc --noEmit -p .` run after every significant change this session — clean (exit 0) at every checkpoint, including after the full encryption rebuild.
- `npx eslint` run against every new/touched file — zero new errors or warnings introduced. Remaining lint findings in touched files are pre-existing (`no-explicit-any` on untouched lines, one pre-existing `let`/`const` warning, one pre-existing a11y false-positive on a lucide icon) and were confirmed line-by-line to predate this session's edits.
