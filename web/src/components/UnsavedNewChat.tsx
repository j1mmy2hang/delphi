import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { LibraryStatus } from '../hooks/useConversationLibrary'

interface Props {
  open: boolean
  status: LibraryStatus
  folderName: string
  onCancel: () => void
  /** Links (or reconnects) a folder, which saves the conversation on screen. */
  onSave: () => void
  onDiscard: () => void
}

/**
 * Asked before leaving a conversation that isn't being saved: it exists only
 * on this screen, so a new one erases it for good. A last chance to keep it
 * by linking a folder — where the browser can save at all.
 *
 * Shaped like an Apple alert: narrow, centred, a question for a title, and
 * full-width buttons stacked with the suggested one first.
 */
export const UnsavedNewChat = ({ open, status, folderName, onCancel, onSave, onDiscard }: Props) => {
  const canSave = status === 'none' || status === 'needs-permission'
  const noFolderApi = status === 'unsupported'
  const button = 'h-10 w-full rounded-xl text-[15px]'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="gap-5 rounded-3xl p-6 text-center shadow-2xl sm:max-w-[300px]"
      >
        <div className="flex flex-col gap-2">
          <DialogTitle className="text-[17px] leading-snug font-semibold">
            {canSave ? 'Save this conversation?' : 'Erase this conversation?'}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-normal">
            {status === 'none' && 'It isn’t saved to a folder yet. A new conversation will erase it for good.'}
            {status === 'needs-permission' &&
              `Delphi lost access to “${folderName}”. A new conversation will erase this one for good.`}
            {noFolderApi && 'This browser can’t save conversations. A new one will erase it for good.'}
            {status === 'loading' && 'It isn’t saved yet. A new conversation will erase it for good.'}
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-2">
          {canSave && (
            <Button autoFocus className={button} onClick={onSave}>
              {status === 'none' ? 'Link a Folder' : 'Reconnect'}
            </Button>
          )}
          <Button
            variant="secondary"
            className={`${button} text-destructive`}
            onClick={onDiscard}
          >
            Erase and Start New
          </Button>
          <Button variant="ghost" className={button} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
