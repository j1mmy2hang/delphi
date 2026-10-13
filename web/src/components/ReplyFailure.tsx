import { CircleAlert } from 'lucide-react'
import type { Failure } from '../chat/failures'

interface Props {
  failure: Failure
  /** Only the latest reply offers an action; older notices are just history. */
  active: boolean
  onRetry: () => void
  onNewChat: () => void
}

/**
 * Why a reply stopped, in place of (or under) the reply: one quiet line, a
 * single next step when there is one. Not a toast — it stays with the turn it
 * belongs to.
 */
export const ReplyFailure = ({ failure, active, onRetry, onNewChat }: Props) => {
  const action =
    active && failure.action === 'retry'
      ? { label: 'Try again', run: onRetry }
      : active && failure.action === 'new-chat'
        ? { label: 'Start a new chat', run: onNewChat }
        : null

  return (
    <div role="alert" className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <CircleAlert aria-hidden="true" className="mt-[3px] size-4 shrink-0 text-destructive" />
      <p>
        {failure.message}
        {action && (
          <>
            {' '}
            <button
              type="button"
              onClick={action.run}
              className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              {action.label}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
