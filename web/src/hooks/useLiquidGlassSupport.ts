import { useState } from 'react'

// SVG filters inside `backdrop-filter` only actually render in Chromium today
// (Safari/Firefox accept the syntax but ignore it). Detect that combination so
// we only swap in the real liquid glass where it works.
const detect = (): boolean => {
  if (typeof window === 'undefined' || typeof CSS === 'undefined' || !CSS.supports) return false
  const ua = navigator.userAgent
  const isFirefox = /firefox|fxios/i.test(ua)
  const isSafari = /^((?!chrome|chromium|crios|android).)*safari/i.test(ua) && !/edg/i.test(ua)
  const supportsBackdropUrl =
    CSS.supports('backdrop-filter', 'url(#x)') || CSS.supports('-webkit-backdrop-filter', 'url(#x)')
  return supportsBackdropUrl && !isFirefox && !isSafari
}

export const useLiquidGlassSupport = (): boolean => {
  const [supported] = useState(detect)
  return supported
}
