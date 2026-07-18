import { useCallback, useEffect, useRef, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'delphi-theme'

/** How long the palette cross-fade runs — keep in sync with `.theming` in index.css. */
const FADE_MS = 500

/**
 * Extra time before `.theming` comes off. The timer starts now but the
 * transition doesn't begin until the next frame, so removing the class at
 * exactly FADE_MS strips it while the fade still has a frame to run — and every
 * element snaps the remainder at once.
 */
const FADE_GRACE_MS = 120

/** The inline script in index.html has already resolved and applied a theme. */
const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

/**
 * The status bar tint has to track the page, and the source of truth for the
 * page colour is `--bg` in index.css — so read it back rather than duplicating
 * the hex here.
 */
const syncThemeColor = () => {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg')
    .trim()
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', bg)
}

/**
 * Manual light/dark with an OS-following default. A stored choice pins the
 * theme; with nothing stored we keep tracking the OS live, so a user who never
 * touches the toggle still sees the system switch at sunset.
 */
export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  const fadeTimer = useRef(0)

  const apply = useCallback((next: Theme) => {
    const root = document.documentElement
    root.classList.add('theming')
    // Flush the transition rules into the before-change style before swapping
    // tokens; otherwise the browser may see both edits in one recalculation and
    // apply the new palette outright instead of animating to it.
    void root.offsetHeight
    root.dataset.theme = next
    setTheme(next)
    syncThemeColor()
    // Restart the window on every switch — without this, toggling twice in
    // quick succession lets the first timer strip `.theming` partway through
    // the second fade, and the palette jumps the rest of the way.
    window.clearTimeout(fadeTimer.current)
    fadeTimer.current = window.setTimeout(
      () => root.classList.remove('theming'),
      FADE_MS + FADE_GRACE_MS
    )
  }, [])

  const toggle = useCallback(() => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, next)
    apply(next)
  }, [apply])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY)) return
      apply(e.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', onSystemChange)
    return () => {
      query.removeEventListener('change', onSystemChange)
      window.clearTimeout(fadeTimer.current)
    }
  }, [apply])

  return { theme, toggle }
}
