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
    // Delphi speaks in lowercase. Done here rather than asked of the model, so
    // it never drifts; code keeps its case, since there case is meaning.
    <MessageResponse
      className="lowercase [&_code]:normal-case [&_pre]:normal-case"
      animated={WORD_FADE}
      isAnimating={writing}
    >
      {shown}
    </MessageResponse>
  )
}
