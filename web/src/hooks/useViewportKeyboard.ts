import { useEffect } from 'react'

// On mobile, focusing the input opens the keyboard and the visualViewport shrinks.
// We pin the page to (0,0) and lift the WHOLE app above the keyboard by translating
// the app container — since it's the containing block for the fixed burst/stage/dock,
// everything rises together and the message stays centred in the visible area.
export const useViewportKeyboard = (
  active: boolean,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  appRef: React.RefObject<HTMLDivElement | null>,
) => {
  useEffect(() => {
    if (!active) return

    const vv = window.visualViewport
    const resetPageScroll = () => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }

    const apply = () => {
      resetPageScroll()
      const el = appRef.current
      if (!el) return
      // How much of the layout viewport the keyboard covers at the bottom.
      const overlap = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
      el.style.transform = overlap > 0 ? `translateY(${-overlap}px)` : ''
    }

    const textarea = textareaRef.current
    const onFocus = () => {
      // iOS defers its keyboard animation; keep re-applying briefly while it slides.
      const start = performance.now()
      const tick = () => {
        apply()
        if (performance.now() - start < 350) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    textarea?.addEventListener('focus', onFocus)

    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      textarea?.removeEventListener('focus', onFocus)
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      if (appRef.current) appRef.current.style.transform = ''
    }
  }, [active, textareaRef, appRef])
}
