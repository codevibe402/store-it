// Persists the account's raw DEK bytes (base64) on this device only, so a
// returning user on the same browser doesn't need to re-enter their recovery
// code every session. Deliberately a separate IndexedDB database from
// StoreItResume (upload/resume caches) — different lifecycle, different
// sensitivity, no reason to share a version number with unrelated features.
const DB_NAME = "StoreItKeys"
const DB_VERSION = 1
const STORE_NAME = "deviceDek"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function storeDeviceDEK(userId: string, rawKeyBase64: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(rawKeyBase64, userId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function getDeviceDEK(userId: string): Promise<string | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const req = tx.objectStore(STORE_NAME).get(userId)
    req.onsuccess = () => { db.close(); resolve(req.result as string | undefined) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function removeDeviceDEK(userId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(userId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
