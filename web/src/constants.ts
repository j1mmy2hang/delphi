import type { Transition } from 'framer-motion'

type Bezier = [number, number, number, number]

// Easing curve for opacity-only fades.
export const EASE: Bezier = [0.25, 0.1, 0.25, 1]

// A slow, organic "settle" — used for forming text out of the cloud.
export const EASE_SETTLE: Bezier = [0.16, 1, 0.3, 1]

// Snappy spring for direct manipulation — taps, scale, button enter/exit.
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32 }

// Gentle spring for the rising user message — the "ascent" into the wave.
export const SPRING_RISE: Transition = { type: 'spring', stiffness: 150, damping: 22 }

// ----------------------------------------------------------------------------
// Conversation choreography (seconds). A single message is on screen at a time;
// it rises from the dock, vibes inside the wave while thinking, dissolves into
// the cloud, and the reply forms back out of it.
// ----------------------------------------------------------------------------
export const STAGE = {
  RISE: 1.25,      // the typed words ascend from the input to the centre
  DISSOLVE: 1.05,  // a message melts back into the cloud
  FORM: 1.25,      // the reply forms out of the cloud
  MIN_THINK: 0.9,  // min dwell the question rests at centre before dissolving
} as const

// Conversation energy per phase (0 calm … 1 churning). PrismaticBurst eases its
// speed, brightness AND ray distortion toward this, so each stage reads at a
// glance: a clear calm → build → peak → ease → calm arc.
export const WAVE_INTENSITY: Record<string, number> = {
  idle: 0.05,      // barely drifting, dim, contemplative
  rising: 0.45,    // energy gathers as the question forms
  thinking: 0.85,  // fast, bright, writhing — the oracle working
  dissolving: 1,   // the peak — rays whip as the message breaks apart
  forming: 0.5,    // easing down as the reply materialises
  settled: 0.12,   // calm again, a touch more alive than idle
}
