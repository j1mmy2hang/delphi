import { useEffect } from 'react'

/**
 * Phones only: keeps the app inside the part of the screen the keyboard leaves
 * visible.
 *
 * iOS Safari doesn't resize the page for the on-screen keyboard — it slides
 * the whole page up instead, so the header scrolls away, the end of the
 * conversation hides behind the keyboard, and the page can stay shifted after
 * it closes. (Chrome on Android resizes on its own, via the viewport meta's
 * interactive-widget=resizes-content.) So on touch screens the app takes the
 * visual viewport's height and the page is pinned back to the top.
 *
 * It also flags `data-keyboard` on <html> while the keyboard is up, for
 * anything that should make way for it.
 *
 * Never on desktop, and not while pinch-zoomed: zooming shrinks the visual
 * viewport too, and following it then would make the app jump about.
 */
export const useMobileViewport = () => {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return
    const root = document.documentElement

    const update = () => {
      if (vv.scale > 1.01) {
        root.style.removeProperty('--app-height')
        root.removeAttribute('data-keyboard')
        return
      }
      // The keyboard takes far more than browser toolbars ever do; 120px
      // tells the two apart.
      root.toggleAttribute('data-keyboard', window.innerHeight - vv.height > 120)
      root.style.setProperty('--app-height', `${Math.round(vv.height)}px`)
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--app-height')
      root.removeAttribute('data-keyboard')
    }
  }, [])
}
