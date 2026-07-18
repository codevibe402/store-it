// Caches the fully-decrypted Blob for a dek-mode (zero-knowledge) file so
// reopening the same file doesn't re-fetch every chunk and re-run AES-GCM
// decryption on it again. Keyed by (fileId, versionId) — a new version gets
// a new versionId, so a stale cache entry is never served for changed
// content; it just becomes an orphan that TTL cleanup eventually removes.
//
// Separate physical database from client/lib/indexedDB.ts's "StoreItResume"
// (upload-resume records) — different lifecycle and purpose, no reason to
// couple this to that module's version/upgrade handling.
const DB_NAME = "StoreItPreviewCache";
const DB_VERSION = 1;
const STORE_NAME = "blobs";
const RECORD_TTL = 24 * 60 * 60 * 1000;

interface CachedBlobRecord {
  blob: Blob;
  mimetype: string;
  storedAt: number;
}

let cleanupRan = false;

function cacheKey(fileId: string, versionId: string): string {
  return `${fileId}:${versionId}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!cleanupRan) {
        cleanupRan = true;
        cleanupOldRecords(db).catch(() => {});
      }
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function cleanupOldRecords(db: IDBDatabase): Promise<void> {
  const cutoff = Date.now() - RECORD_TTL;
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const req = store.openCursor();
  return new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const record = cursor.value as CachedBlobRecord;
        if (record.storedAt < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedPreviewBlob(
  fileId: string,
  versionId: string,
): Promise<{ blob: Blob; mimetype: string } | undefined> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(cacheKey(fileId, versionId));
      req.onsuccess = () => {
        db.close();
        const record = req.result as CachedBlobRecord | undefined;
        resolve(record ? { blob: record.blob, mimetype: record.mimetype } : undefined);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    // Cache is a pure optimization — any IndexedDB failure (private
    // browsing, quota, disabled storage) just means falling back to a live
    // fetch, never a broken preview.
    return undefined;
  }
}

export async function storeCachedPreviewBlob(
  fileId: string,
  versionId: string,
  blob: Blob,
  mimetype: string,
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const record: CachedBlobRecord = { blob, mimetype, storedAt: Date.now() };
      tx.objectStore(STORE_NAME).put(record, cacheKey(fileId, versionId));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch {
    // Best-effort — e.g. storage quota exceeded on a large file. Not
    // caching it just means the next open pays the live-fetch cost again.
  }
}
