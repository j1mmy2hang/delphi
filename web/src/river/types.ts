/**
 * The thought river: the moves that carried a conversation's thinking, in
 * order, each linked back to what it rests on. Mirrors the shape returned by
 * netlify/functions/river.mts.
 */

export type Speaker = 'user' | 'delphi'
export type MoveKind = 'question' | 'claim' | 'evidence' | 'realization'
export type RestHow = 'builds' | 'answers' | 'challenges'

export interface Move {
  id: string
  /** The message it came from, counting from 1. */
  at: number
  by: Speaker
  kind: MoveKind
  label: string
  /** The earlier moves it depends on, and how. */
  rests: { on: string; how: RestHow }[]
  /** A position the user let go of: the later move that replaced it. */
  revisedBy?: string
}

export interface River {
  title: string
  /** How many messages have been read into the river. */
  upTo: number
  moves: Move[]
  /** How many messages had been read at the last reflection. */
  reflectedAt: number
  /** What the last reflection saw in the river, addressed to the user. */
  insight: string
}

/** What the client keeps per conversation. */
export interface ThoughtRiverState {
  river: River
  /** Bumped when the river grows or is reflected on, so the header button can say "something new". */
  version: number
}

export const EMPTY_RIVER: River = { title: '', upTo: 0, moves: [], reflectedAt: 0, insight: '' }

export const EMPTY_STATE: ThoughtRiverState = { river: EMPTY_RIVER, version: 0 }
