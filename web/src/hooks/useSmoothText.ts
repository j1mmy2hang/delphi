import { useEffect, useRef, useState } from 'react'

/** Never slower than this while text is waiting — a comfortable reading pace. */
const MIN_CHARS_PER_SEC = 45
/** Never faster than this, however much has piled up. */
const MAX_CHARS_PER_SEC = 450
/** Aim to clear whatever is waiting in about this long. */
const CATCH_UP_SECONDS = 0.9

/**
 * Releases a growing string at a steady pace, whole words at a time.
 *
 * Model output reaches the browser in uneven chunks — on a phone, sometimes
 * most of a reply at once. Showing each chunk as it lands makes the reply
 * jump and the scroll lurch. Instead `target` fills a buffer and the returned
 * text catches up frame by frame: fast when a lot is waiting, never slower
 * than a reading pace, so a burst plays out over about a second instead of a
 * single frame. Text only grows by whole words, so the renderer's per-word
 * fade never sees half a word.
 *
 * With `active` false from the start (a finished or saved reply), everything
 * shows at once. If `active` turns false mid-way (the stream ended or was
 * stopped), what's already received still plays out rather than snapping in.
 */
export const useSmoothText = (target: string, active: boolean): string => {
  const [shown, setShown] = useState(() => (active ? '' : target))
  const lengthRef = useRef(shown.length)
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let carry = 0 // fractional characters owed from earlier frames

    const tick = (now: number) => {
      const full = targetRef.current
      const backlog = full.length - lengthRef.current
      if (backlog <= 0) {
        frame = 0
        return
      }
      const dt = Math.min((now - last) / 1000, 0.1) // a background tab mustn't dump it all
      last = now
      const rate = Math.min(
        MAX_CHARS_PER_SEC,
        Math.max(MIN_CHARS_PER_SEC, backlog / CATCH_UP_SECONDS),
      )
      carry += rate * dt
      const step = Math.floor(carry)
      if (step > 0) {
        carry -= step
        let next = Math.min(full.length, lengthRef.current + step)
        // Finish the word in progress rather than cut it.
        while (next < full.length && !/\s/.test(full[next])) next++
        lengthRef.current = next
        setShown(full.slice(0, next))
      }
      frame = requestAnimationFrame(tick)
    }

    // The text can also shrink: a hidden tag (<think>…) is stripped once it's
    // complete. Clamp rather than point past the end.
    if (lengthRef.current > target.length) {
      lengthRef.current = target.length
      setShown(target)
    }

    if (lengthRef.current < target.length && !frame) {
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(frame)
  }, [target])

  return shown
}
