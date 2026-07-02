import { useEffect, useRef } from 'react'

const MAX_FADE = 52 // px — how tall the top/bottom fade grows to

/**
 * A centred message block. When it's taller than its bounds it scrolls, and the
 * top/bottom edges fade out (mask) in proportion to how far there is to scroll
 * in that direction — so the reader sees there's more above/below.
 */
interface Props {
  html: string
  className?: string
}

export const StageText = ({ html, className = '' }: Props) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const overflow = el.scrollHeight - el.clientHeight
      const scrollable = overflow > 2
      el.classList.toggle('is-scrollable', scrollable)
      const top = scrollable ? Math.min(el.scrollTop, MAX_FADE) : 0
      const bottom = scrollable ? Math.min(overflow - el.scrollTop, MAX_FADE) : 0
      el.style.setProperty('--fade-top', `${top}px`)
      el.style.setProperty('--fade-bottom', `${bottom}px`)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [html])

  return (
    <div
      ref={ref}
      className={`stage-text ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
