import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { LibraryStatus } from '../hooks/useConversationLibrary'

const isPhone = () => window.matchMedia('(pointer: coarse)').matches

/**
 * Phones don't offer saving at all, so there's nothing to tell them — or to
 * reserve room for. (Known from the first render: no folder API means
 * 'unsupported' immediately, so the layout never shifts.)
 */
export const isSaveStatusOmitted = (status: LibraryStatus) =>
  status === 'unsupported' && isPhone()

interface Props {
  status: LibraryStatus
  folderName: string
  chatStarted: boolean
  onChooseFolder: () => void
  onReconnect: () => void
  onOpenHistory: () => void
}

/**
 * One quiet line under the composer that says where this conversation goes, and is
 * itself the way to set saving up — no banner, no onboarding. A hollow dot
 * means one-time; a filled dot means it's being written to a folder.
 */
export const SaveStatus = ({
  status,
  folderName,
  chatStarted,
  onChooseFolder,
  onReconnect,
  onOpenHistory,
}: Props) => {
  if (status === 'loading' || isSaveStatusOmitted(status)) return null

  const saved = status === 'ready'
  const { label, hint, onClick } = describe()

  function describe() {
    switch (status) {
      case 'ready':
        return {
          label: chatStarted ? `Saved to ${folderName}` : `Saving to ${folderName}`,
          hint: 'Each conversation is a Markdown file in this folder.',
          onClick: onOpenHistory,
        }
      case 'needs-permission':
        return {
          label: 'Not saved · Reconnect',
          hint: `Allow access to “${folderName}” again to keep saving there.`,
          onClick: onReconnect,
        }
      case 'none':
        return {
          label: 'Not saved',
          hint: 'Select or create a folder where all your conversations with Delphi will be saved.',
          onClick: onChooseFolder,
        }
      default:
        return {
          label: 'Not saved',
          hint: 'Saving to a folder needs Chrome or Edge on a computer.',
          onClick: undefined,
        }
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          // Unsupported browsers get the explanation, not a dead button.
          aria-disabled={!onClick}
          className={cn(
            'flex h-8 items-center gap-2 rounded-full px-3 text-xs text-muted-foreground transition-colors',
            onClick ? 'hover:bg-accent hover:text-foreground' : 'cursor-default',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              saved ? 'bg-foreground/70' : 'border border-muted-foreground',
            )}
          />
          <span className="max-w-[40vw] truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{hint}</TooltipContent>
    </Tooltip>
  )
}
