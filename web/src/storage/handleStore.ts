/**
 * Remembers the chosen folder between visits. A directory handle can't go in
 * localStorage (it isn't a string), but IndexedDB stores it as-is. This is the
 * only thing kept in the browser; the conversations live in the folder.
 */

const DB = 'delphi'
const STORE = 'handles'
const KEY = 'conversations-dir'

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = op(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close())
}

export const loadDirHandle = () =>
  run<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY))

export const saveDirHandle = (handle: FileSystemDirectoryHandle) =>
  run('readwrite', (s) => s.put(handle, KEY))

export const clearDirHandle = () => run('readwrite', (s) => s.delete(KEY))
