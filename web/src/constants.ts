import type { Transition } from 'framer-motion'

// Easing curve for opacity-only fades (hero, message list).
export const EASE = [0.25, 0.1, 0.25, 1] as const

// Snappy spring for direct manipulation — taps, scale, button enter/exit.
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32 }

// Gentle spring for layout morphs and content entrance — the Apple "settle".
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 240, damping: 28 }
