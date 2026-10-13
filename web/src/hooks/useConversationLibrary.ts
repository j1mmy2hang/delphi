import { useCallback, useEffect, useRef, useState } from 'react'
import type { Conversation } from '../types'
import { fileNameFor, parse, parseMeta, serialize } from '../storage/conversationFile'
import { clearDirHandle, loadDirHandle, saveDirHandle } from '../storage/handleStore'

/**
 * Conversations saved as Markdown files in a folder the user picks.
 *
 * Built on the File System Access API, which only desktop Chromium (Chrome,
 * Edge, Arc, Brave…) ships. Everywhere else — phones, Safari, Firefox — the
 * status is 'unsupported' and the app simply doesn't save, as before.
 *
 * Statuses:
 *   unsupported       no folder API in this browser
 *   loading           checking for a remembered folder
 *   none              no folder chosen yet
 *   needs-permission  a folder is remembered, but this visit hasn't been
 *                     granted access; re-granting needs a click (reconnect)
 *   ready             reading and writing
 */
export type LibraryStatus = 'unsupported' | 'loading' | 'none' | 'needs-permission' | 'ready'

export interface LibraryEntry {
  id: string
  title: string
  updated: string
  fileName: string
}

const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

const READWRITE = { mode: 'readwrite' } as const

const exists = async (dir: FileSystemDirectoryHandle, name: string) => {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

const byUpdatedDesc = (a: LibraryEntry, b: LibraryEntry) =>
  Date.parse(b.updated) - Date.parse(a.updated)

export const useConversationLibrary = () => {
  const [status, setStatus] = useState<LibraryStatus>(supported ? 'loading' : 'unsupported')
  const [folderName, setFolderName] = useState('')
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  // Bumped whenever a folder becomes active, so callers can tell "same folder,
  // still ready" from "a different folder, also ready".
  const [generation, setGeneration] = useState(0)
  const dirRef = useRef<FileSystemDirectoryHandle | null>(null)
  // id → file name, so a conversation keeps writing to the file it started in
  // even after a reload (it isn't renamed when its title would change).
  const filesRef = useRef(new Map<string, string>())
  // One write at a time per file; createWritable() swaps the file in on
  // close, and two overlapping writers would race to be the last swap.
  const queueRef = useRef(new Map<string, Promise<void>>())

  const scan = useCallback(async (dir: FileSystemDirectoryHandle) => {
    const found: LibraryEntry[] = []
    for await (const handle of dir.values()) {
      if (handle.kind !== 'file' || !handle.name.endsWith('.md')) continue
      try {
        const text = await (await handle.getFile()).text()
        const meta = parseMeta(text)
        // Other notes can share the folder (an Obsidian vault, say); only
        // files written by Delphi carry an id.
        if (!meta.id) continue
        found.push({
          id: meta.id,
          title: meta.title || handle.name.replace(/\.md$/, ''),
          updated: meta.updated || meta.created || '',
          fileName: handle.name,
        })
      } catch {
        // Unreadable file: skip it rather than fail the whole list.
      }
    }
    filesRef.current = new Map(found.map((e) => [e.id, e.fileName]))
    setEntries(found.sort(byUpdatedDesc))
  }, [])

  const forget = useCallback(async () => {
    await clearDirHandle().catch(() => undefined)
    dirRef.current = null
    filesRef.current = new Map()
    setEntries([])
    setFolderName('')
    setStatus('none')
  }, [])

  const activate = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      dirRef.current = dir
      setFolderName(dir.name)
      try {
        await scan(dir)
      } catch {
        // The folder was deleted or moved since it was chosen.
        return forget()
      }
      setGeneration((g) => g + 1)
      setStatus('ready')
    },
    [scan, forget],
  )

  // Restore the folder from the last visit. Chrome may still hold the
  // permission (it offers "allow on every visit"); if not, wait for a click.
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    ;(async () => {
      const dir = await loadDirHandle().catch(() => undefined)
      if (cancelled) return
      if (!dir) return setStatus('none')
      setFolderName(dir.name)
      dirRef.current = dir
      if ((await dir.queryPermission(READWRITE)) === 'granted') await activate(dir)
      else setStatus('needs-permission')
    })()
    return () => {
      cancelled = true
    }
  }, [activate])

  /** Opens the system folder picker. Must be called from a click. */
  const chooseFolder = useCallback(async () => {
    try {
      const dir = await window.showDirectoryPicker!({ id: 'delphi', mode: 'readwrite', startIn: 'documents' })
      await saveDirHandle(dir)
      await activate(dir)
    } catch (err) {
      // Closing the picker is a choice, not an error.
      if ((err as Error).name !== 'AbortError') throw err
    }
  }, [activate])

  /** Re-grants access to the remembered folder. Must be called from a click. */
  const reconnect = useCallback(async () => {
    const dir = dirRef.current
    if (!dir) return
    if ((await dir.requestPermission(READWRITE)) === 'granted') await activate(dir)
  }, [activate])

  /** Stops saving to the folder. The files in it are left as they are. */
  const unlink = forget

  /** Deletes a conversation's file. Permanent: the API has no trash. */
  const remove = useCallback(async (entry: LibraryEntry) => {
    const dir = dirRef.current
    if (!dir) return
    // Let a pending write finish first, or it would recreate the file.
    await queueRef.current.get(entry.id)
    try {
      await dir.removeEntry(entry.fileName)
    } catch (err) {
      if ((err as Error).name !== 'NotFoundError') throw err
    }
    filesRef.current.delete(entry.id)
    queueRef.current.delete(entry.id)
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
  }, [])

  const save = useCallback((c: Conversation) => {
    const dir = dirRef.current
    if (!dir || status !== 'ready' || c.messages.length === 0) return

    const write = async () => {
      let name = filesRef.current.get(c.id)
      if (!name) {
        // A new conversation: never overwrite another file with the same title.
        name = fileNameFor(c)
        for (let n = 2; await exists(dir, name); n++) name = fileNameFor(c, ` (${n})`)
        filesRef.current.set(c.id, name)
      }
      const file = await dir.getFileHandle(name, { create: true })
      const writable = await file.createWritable()
      await writable.write(serialize(c))
      await writable.close()

      const entry: LibraryEntry = { id: c.id, title: c.title, updated: c.updated, fileName: name }
      setEntries((prev) => [entry, ...prev.filter((e) => e.id !== c.id)].sort(byUpdatedDesc))
    }

    const prev = queueRef.current.get(c.id) ?? Promise.resolve()
    const next = prev.then(write).catch((err) => {
      // Access revoked mid-session (site settings, or the folder moved).
      if ((err as Error).name === 'NotAllowedError') setStatus('needs-permission')
      else console.error('Could not save conversation', err)
    })
    queueRef.current.set(c.id, next)
  }, [status])

  const open = useCallback(async (entry: LibraryEntry): Promise<Conversation | null> => {
    const dir = dirRef.current
    if (!dir) return null
    try {
      const file = await (await dir.getFileHandle(entry.fileName)).getFile()
      return parse(await file.text())
    } catch {
      // Deleted or renamed outside the app since the list was read.
      await scan(dir)
      return null
    }
  }, [scan])

  return { status, folderName, entries, generation, chooseFolder, reconnect, unlink, save, open, remove }
}
