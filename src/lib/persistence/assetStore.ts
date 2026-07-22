// Binary media blobs live in IndexedDB (localStorage can't hold them), keyed by
// asset id. Adapted from screenshot-bro's image-store. All functions degrade
// gracefully (reject/no-op) where IndexedDB is unavailable, e.g. private browsing
// or SSR — the DB is opened lazily, never at import.

const DB_NAME = 'captions-bro'
const STORE = 'assets'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => {
      resolve(req.result)
    }
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB open failed'))
    }
  })
  return dbPromise
}

export async function putAssetBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => {
      resolve()
    }
    tx.onerror = () => {
      reject(tx.error ?? new Error('put failed'))
    }
  })
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb()
  return new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => {
      resolve(req.result as Blob | undefined)
    }
    req.onerror = () => {
      reject(req.error ?? new Error('get failed'))
    }
  })
}

export async function deleteAssetBlob(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => {
      resolve()
    }
    tx.onerror = () => {
      reject(tx.error ?? new Error('delete failed'))
    }
  })
}

export async function allAssetIds(): Promise<string[]> {
  const db = await openDb()
  return new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => {
      resolve(req.result as string[])
    }
    req.onerror = () => {
      reject(req.error ?? new Error('keys failed'))
    }
  })
}
