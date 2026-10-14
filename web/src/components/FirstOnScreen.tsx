import { useEffect } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'

/**
 * Reports the index of the first message on screen once an opened conversation
 * has settled at its end, so its entrance cascade starts there — whatever
 * fits on screen, long replies or short ones. Messages mark themselves with
 * `data-message={i}`. Renders nothing.
 *
 * Two frames: the jump to the end and the ScrollPastEnd runway both happen in
 * ResizeObserver callbacks after the first layout, so the second frame is the
 * first that sees where things rest.
 */
export const FirstOnScreen = ({ onMeasure }: { onMeasure: (index: number) => void }) => {
  const { scrollRef, contentRef } = useStickToBottomContext()

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const scroller = scrollRef.current
        const content = contentRef.current
        if (!scroller || !content) return onMeasure(0)
        const top = scroller.getBoundingClientRect().top
        const messages = content.querySelectorAll<HTMLElement>('[data-message]')
        const first = [...messages].find((m) => m.getBoundingClientRect().bottom > top)
        onMeasure(first ? Number(first.dataset.message) : 0)
      })
    })
    return () => cancelAnimationFrame(frame)
    // Once per opened conversation: the Conversation is keyed by its id.
  }, [scrollRef, contentRef])

  return null
}
