import { MessageResponse } from '@/components/ai-elements/message'
import { useSmoothText } from '../hooks/useSmoothText'

// Per-word fade on top of the paced release: each word the pacing lets
// through eases in rather than popping.
const WORD_FADE = {
  animation: 'fadeIn',
  duration: 220,
  easing: 'ease-out',
  sep: 'word',
  stagger: 18,
  maxBacklogMs: 400,
} as const

/**
 * An assistant reply. While it's being written, text is released at a steady
 * pace (useSmoothText) and each new word fades in; a finished or saved reply
 * renders at once.
 */
export const StreamingReply = ({ text, streaming }: { text: string; streaming: boolean }) => {
  const shown = useSmoothText(text, streaming)
  const writing = streaming || shown.length < text.length
  return (
    <MessageResponse animated={WORD_FADE} isAnimating={writing}>
      {shown}
    </MessageResponse>
  )
}
