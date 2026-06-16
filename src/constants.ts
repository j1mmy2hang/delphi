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
// Both roles emerge and dissolve identically; RISE === FORM keeps them in sync.
export const STAGE = {
  RISE: 1.25,      // a message materialises out of the wave
  DISSOLVE: 1.05,  // a message melts back into the cloud
  FORM: 1.25,      // identical to RISE so user/assistant match exactly
  MIN_THINK: 1.3,  // floor so the wave always "thinks" for a beat
} as const

// Target wave energy per phase (0 calm … 1 churning). WaveField eases toward it.
// Kept gentle — even "thinking" only stirs the wave a little.
export const WAVE_INTENSITY: Record<string, number> = {
  idle: 0.08,
  rising: 0.3,
  thinking: 0.5,
  dissolving: 0.6,
  forming: 0.38,
  settled: 0.16,
}
