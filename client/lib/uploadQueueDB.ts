export interface QueueItem {
  id: string;
  filename: string;
  size: number;
  lastModified: number;
  type: string;
  storedAt: number;
  handle?: FileSystemFileHandle;
  data?: ArrayBuffer;
}

const DB_NAME = "StoreItResume"
// Shared physical IndexedDB database with client/lib/indexedDB.ts (same
// DB_NAME) — keep DB_VERSION in sync with that module.
const DB_VERSION = 3
const STORE_NAME = "uploadQueue"
const RECORD_TTL = 24 * 60 * 60 * 1000

let cleanupRan = false

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files")
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (!cleanupRan) {
        cleanupRan = true
        cleanupOldRecords(db)
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

async function cleanupOldRecords(db: IDBDatabase): Promise<void> {
  const cutoff = Date.now() - RECORD_TTL
  if (!db.objectStoreNames.contains(STORE_NAME)) return
  const tx = db.transaction(STORE_NAME, "readwrite")
  const store = tx.objectStore(STORE_NAME)
  const req = store.openCursor()
  req.onsuccess = () => {
    const cursor = req.result
    if (cursor) {
      const key = cursor.key as string
      const record = cursor.value as QueueItem
      if (record.storedAt < cutoff) {
        cursor.delete()
      }
      cursor.continue()
    }
  }
}

export async function storeQueueItem(key: string, item: QueueItem): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(item, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function getAllQueueItems(): Promise<Map<string, QueueItem>> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.close()
      resolve(new Map())
      return
    }
    const tx = db.transaction(STORE_NAME, "readonly")
    const req = tx.objectStore(STORE_NAME).openCursor()
    const items = new Map<string, QueueItem>()
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        items.set(cursor.key as string, cursor.value as QueueItem)
        cursor.continue()
      } else {
        db.close()
        resolve(items)
      }
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function removeQueueItem(key: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
