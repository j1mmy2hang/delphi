import type { Transition } from 'framer-motion'

// Snappy spring for direct manipulation — taps, scale, button enter/exit.
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32 }

// Gentle spring for layout morphs and content entrance — the Apple "settle".
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 240, damping: 28 }

// The home → chat move. Critically damped (ζ ≈ 1): the composer glides to its
// new place and stops without overshooting — a bounce reads as a mistake on a
// control that's still holding your cursor. Settles in about half a second.
export const SPRING_GLIDE: Transition = { type: 'spring', stiffness: 320, damping: 36 }

// Exits leave quickly and accelerate away (ease-in); entrances arrive and
// decelerate into place (ease-out). Both are short, so the composer's glide is
// the only motion the eye follows.
export const EASE_IN = [0.4, 0, 1, 1] as const
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
