import { useEffect } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'

/**
 * Marks the message list `data-scrolled` once anything has scrolled up past
 * its top edge. On phones, where the header buttons float over the messages,
 * index.css fades the top of the list only then — at rest, nothing is hidden
 * behind the buttons, so there's nothing to fade. Renders nothing.
 */
export const ScrollEdge = () => {
  const { scrollRef } = useStickToBottomContext()

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const update = () => {
      const scrolled = scroller.scrollTop > 4
      // Touch the DOM only when the state flips, not on every scroll event.
      if (scrolled !== (scroller.dataset.scrolled === 'true')) {
        scroller.dataset.scrolled = String(scrolled)
      }
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [scrollRef])

  return null
}
