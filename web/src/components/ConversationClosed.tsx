import { motion } from 'framer-motion'
import { MessageCirclePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EASE_OUT } from '../constants'

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

interface ConversationClosedProps {
  /** When it closed (ISO); today if not yet known. */
  closed?: string
  /** Opens the thought river; absent where there's no river to show. */
  onShowRiver?: () => void
  onNewChat: () => void
}

/**
 * Where the composer was, once Delphi has closed the conversation: the end,
 * said plainly, and the two ways on — the shape this conversation took, or a
 * new one. Nothing to type into, so nothing more can be said here.
 */
export const ConversationClosed = ({ closed, onShowRiver, onNewChat }: ConversationClosedProps) => {
  const date = dateFormat.format(closed ? new Date(closed) : new Date())
  return (
    <motion.div
      role="status"
      className="flex flex-col items-center gap-4 px-2 pt-1 pb-1 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT, delay: 0.15 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      {/* The river's ending: two lanes meeting at a gold point. */}
      <svg width="56" height="14" viewBox="0 0 56 14" fill="none" aria-hidden className="text-muted-foreground/50">
        <path d="M0 3 C24 3 30 7 44 7" stroke="currentColor" strokeWidth="1" />
        <path d="M0 11 C24 11 30 7 44 7" stroke="currentColor" strokeWidth="1" />
        <circle cx="48" cy="7" r="3" fill="var(--river-gold)" />
      </svg>
      <div className="space-y-1">
        <p className="font-serif text-[17px] text-foreground">This conversation has come to a close.</p>
        <p className="text-[13px] text-muted-foreground">
          Closed {date}. Take what you found with you, and come back with something new.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onShowRiver && (
          <Button variant="outline" size="lg" className="rounded-full px-4" onClick={onShowRiver}>
            See the shape of your thinking
          </Button>
        )}
        <Button size="lg" className="rounded-full px-4" onClick={onNewChat}>
          <MessageCirclePlus className="size-4" />
          New conversation
        </Button>
      </div>
    </motion.div>
  )
}
