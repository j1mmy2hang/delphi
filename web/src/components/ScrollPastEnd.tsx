import { useEffect, useRef } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'

/** At most this share of the message area is runway below the last line. */
const MAX_SHARE = 0.4

/**
 * "Scroll past end": room below the last message, so that once a conversation
 * outgrows the screen its newest line rests a little below the middle instead
 * of against the composer. The Conversation keeps following the bottom while a
 * reply streams, which holds that line at the same height as text arrives.
 *
 * The runway equals how far the messages overflow, capped at MAX_SHARE of the
 * viewport — so a conversation that fits gets none (nothing scrolls), and the
 * last line eases up to its resting place as the content grows rather than
 * jumping there the moment it overflows.
 *
 * Height is written straight to the DOM from a ResizeObserver: it changes on
 * every streamed line, and routing that through React state would re-render
 * the whole message list each time.
 */
export const ScrollPastEnd = () => {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollRef, contentRef } = useStickToBottomContext()

  useEffect(() => {
    const spacer = ref.current
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!spacer || !scroller || !content) return

    const update = () => {
      // Everything above the spacer, measured without the spacer itself — so
      // resizing it can't feed back into the next measurement.
      const messages = spacer.getBoundingClientRect().top - content.getBoundingClientRect().top
      const viewport = scroller.clientHeight
      const runway = Math.min(Math.max(messages - viewport, 0), viewport * MAX_SHARE)
      spacer.style.height = `${Math.round(runway)}px`
    }

    const observer = new ResizeObserver(update)
    observer.observe(content)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [scrollRef, contentRef])

  // -mt-8 cancels the list's gap-8, so a zero-height runway adds no space.
  return <div ref={ref} aria-hidden="true" className="-mt-8 shrink-0" />
}
