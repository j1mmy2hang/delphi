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
}

export interface River {
  title: string
  /** How many messages have been read into the river. */
  upTo: number
  moves: Move[]
}

/** What the client keeps per conversation. */
export interface ThoughtRiverState {
  river: River
  /** Bumped when the river grows, so the header button can say "something new". */
  version: number
}

export const EMPTY_RIVER: River = { title: '', upTo: 0, moves: [] }

export const EMPTY_STATE: ThoughtRiverState = { river: EMPTY_RIVER, version: 0 }
