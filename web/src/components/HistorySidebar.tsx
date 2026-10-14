import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronsUpDown, FolderIcon, FolderOpen, Trash2, Unlink } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { LibraryEntry } from '../hooks/useConversationLibrary'
import { SPRING_GLIDE } from '../constants'

const WIDTH = 260

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** Time today, the date otherwise. */
const when = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toDateString() === new Date().toDateString() ? timeFormat.format(d) : dayFormat.format(d)
}

interface Props {
  open: boolean
  folderName: string
  entries: LibraryEntry[]
  currentId: string | null
  onSelect: (entry: LibraryEntry) => void
  onDelete: (entry: LibraryEntry) => void
  onChangeFolder: () => void
  onUnlink: () => void
}

/**
 * Saved conversations, newest first, with the folder they live in at the foot.
 * Width animates open and shut; the inner panel keeps its full width so the
 * list is clipped, never reflowed, mid-move.
 */
export const HistorySidebar = ({
  open,
  folderName,
  entries,
  currentId,
  onSelect,
  onDelete,
  onChangeFolder,
  onUnlink,
}: Props) => {
  // The one row asking "Delete?" — a second click confirms. Deleting removes
  // the file for good, so it takes two deliberate clicks, but no dialog.
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? WIDTH : 0 }}
      transition={SPRING_GLIDE}
      className="h-dvh shrink-0 overflow-hidden border-r border-border/0 data-[open=true]:border-border"
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div style={{ width: WIDTH }} className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center px-4">
          <h2 className="text-sm font-medium">History</h2>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {entries.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Conversations will appear here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {entries.map((entry) => {
                const isConfirming = confirming === entry.id
                return (
                  <li
                    key={entry.id}
                    className="group/row relative"
                    onMouseLeave={() => isConfirming && setConfirming(null)}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(entry)}
                      title={entry.fileName}
                      className={cn(
                        'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                        entry.id === currentId && 'bg-accent',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                      {/* In flow, so a long title truncates before it; the
                          delete button covers its place on hover. */}
                      <span className="shrink-0 text-xs text-muted-foreground transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0">
                        {when(entry.updated)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isConfirming) return setConfirming(entry.id)
                        setConfirming(null)
                        onDelete(entry)
                      }}
                      onBlur={() => isConfirming && setConfirming(null)}
                      aria-label={isConfirming ? `Confirm delete ${entry.title}` : `Delete ${entry.title}`}
                      className={cn(
                        'absolute top-1/2 right-1 flex h-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100',
                        isConfirming
                          ? 'bg-destructive px-2 text-xs font-medium text-white opacity-100'
                          : 'w-7 hover:text-foreground',
                      )}
                    >
                      {isConfirming ? 'Delete?' : <Trash2 className="size-3.5" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </nav>

        {/* Where the files live, and the way to change or forget it. */}
        <div className="shrink-0 border-t border-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <FolderIcon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{folderName}</span>
                <ChevronsUpDown className="size-3.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width)">
              <DropdownMenuItem onSelect={onChangeFolder}>
                <FolderOpen />
                Change folder…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onUnlink}>
                <Unlink />
                Stop saving here
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.aside>
  )
}
