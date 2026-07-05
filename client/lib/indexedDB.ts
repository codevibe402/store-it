export interface UploadRecord {
  fileId: string
  handle: FileSystemFileHandle
  filename: string
  size: number
  lastModified: number
  storedAt: number
}

const DB_NAME = "StoreItResume"
const DB_VERSION = 2
const STORE_NAME = "files"
const RECORD_TTL = 24 * 60 * 60 * 1000

let cleanupRan = false

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => {
      const db = request.result
      if (!cleanupRan) {
        cleanupRan = true
        cleanupOldRecords(db).catch(() => {})
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

async function cleanupOldRecords(db: IDBDatabase): Promise<void> {
  const cutoff = Date.now() - RECORD_TTL
  const tx = db.transaction(STORE_NAME, "readwrite")
  const store = tx.objectStore(STORE_NAME)
  const req = store.openCursor()
  return new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        const key = cursor.key as string
        const record = cursor.value as UploadRecord
        if (record.storedAt < cutoff) {
          cursor.delete()
        }
        cursor.continue()
      } else {
        resolve()
      }
    }
    req.onerror = () => reject(req.error)
  })
}

export async function storeFile(key: string, record: UploadRecord): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(record, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function getFile(fileId: string): Promise<UploadRecord | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const req = tx.objectStore(STORE_NAME).get(fileId)
    req.onsuccess = () => { db.close(); resolve(req.result as UploadRecord | undefined) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function removeFile(fileId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(fileId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
