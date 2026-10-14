import type { Move, Speaker } from './types'

/**
 * Where everything in the river goes. Time runs right, counted in moves
 * rather than messages: a message with nothing in it leaves only a small gap,
 * so flat stretches close up and dense ones get room. The user's lane is on
 * top with labels above it; Delphi's is below with labels beneath, so the
 * links between them have the middle to themselves. Each lane's labels take
 * two staggered rows, so neighbours don't collide.
 */

export interface Point {
  x: number
  y: number
}

export interface Placed extends Point {
  /** The label, broken into at most two lines, and where its first line sits. */
  lines: string[]
  labelY: number
  /** Width of the label's longer line. */
  labelWidth: number
}

export interface RiverLayout {
  /** The river's full width; it can be wider than the view, which scrolls. */
  width: number
  lanes: Record<Speaker, number>
  placed: Map<string, Placed>
}

/**
 * The lanes' heights: a little below the middle (labels above the user's lane
 * need the room), with the gap between them capped so a tall view doesn't
 * stretch the links thin.
 */
export const lanesFor = (height: number): Record<Speaker, number> => {
  const gap = Math.min(height * 0.32, 230)
  const middle = height * 0.54
  return { user: Math.round(middle - gap / 2), delphi: Math.round(middle + gap / 2) }
}

export const LABEL_SIZE = 11.5
export const LINE_HEIGHT = 14
/** A label wraps at about eight Chinese characters. */
const MAX_LINE = 96
/** Room at the left for the lane names and half a label, and at the right to end on. */
const PAD_LEFT = 124
const PAD_RIGHT = 64
/** The narrowest step between moves, and the widest when there's room to spare. */
const MIN_STEP = 44
const MAX_STEP = 96
/** What a message with no moves adds, as a share of a step. */
const QUIET = 0.3

type Measure = (text: string) => number

/**
 * Breaks a label into at most two lines of about eight characters, split near
 * the middle — at a pause if there's one close by — so neither line is a
 * stub.
 */
const wrap = (label: string, measure: Measure): string[] => {
  if (measure(label) <= MAX_LINE) return [label]
  const chars = [...label]
  let cut = Math.ceil(chars.length / 2)
  for (const d of [0, 1, -1, 2, -2]) {
    if (/[，、：；,:; ]/.test(chars[cut - 1 + d] ?? '')) {
      cut += d
      break
    }
  }
  const first = chars.slice(0, cut).join('').trim()
  let rest = chars.slice(cut).join('').trim()
  while (measure(rest) > MAX_LINE && rest.length > 1) rest = rest.slice(0, -2) + '…'
  return [first, rest]
}

export const layoutRiver = (
  moves: Move[],
  upTo: number,
  view: { width: number; height: number },
  measure: Measure,
): RiverLayout => {
  // Time: each move a step, each empty message a sliver.
  const counts = new Map<number, number>()
  for (const m of moves) counts.set(m.at, (counts.get(m.at) ?? 0) + 1)
  const last = Math.max(upTo, moves.at(-1)?.at ?? 0)
  let units = 0
  const unitOf = new Map<string, number>()
  let i = 0
  for (let at = 1; at <= last; at++) {
    const k = counts.get(at) ?? 0
    if (!k) {
      units += QUIET
      continue
    }
    for (let j = 0; j < k; j++) unitOf.set(moves[i++].id, units + j)
    units += k
  }
  const span = Math.max(1, units - 1)
  const room = view.width - PAD_LEFT - PAD_RIGHT
  const step = Math.min(MAX_STEP, Math.max(MIN_STEP, room / span))
  const width = Math.max(view.width, PAD_LEFT + PAD_RIGHT + span * step)

  // Lanes: the middle third is for the links; labels sit outside it.
  const lanes = lanesFor(view.height)

  const placed = new Map<string, Placed>()
  const rowEnds: Record<Speaker, [number, number]> = { user: [-Infinity, -Infinity], delphi: [-Infinity, -Infinity] }
  for (const m of moves) {
    const x = PAD_LEFT + (unitOf.get(m.id) ?? 0) * step
    const y = lanes[m.by]
    const lines = wrap(m.label, measure)
    const labelWidth = Math.max(...lines.map(measure))
    // The nearer row if it's free, else the farther one, else whichever
    // frees up first.
    const ends = rowEnds[m.by]
    const left = x - labelWidth / 2
    const row = ends[0] + 8 <= left ? 0 : ends[1] + 8 <= left ? 1 : ends[0] <= ends[1] ? 0 : 1
    ends[row] = x + labelWidth / 2
    const block = lines.length * LINE_HEIGHT
    const gap = 12 + row * (2 * LINE_HEIGHT + 6)
    // First line's centre: above the user's lane, below Delphi's.
    const labelY = m.by === 'user' ? y - gap - block + LINE_HEIGHT / 2 : y + gap + LINE_HEIGHT / 2
    placed.set(m.id, { x, y, lines, labelY, labelWidth })
  }
  return { width, lanes, placed }
}

/** A link from an earlier move to a later one. */
export const linkPath = (a: Point, b: Point, lanes: Record<Speaker, number>): string => {
  const dx = Math.max(1, b.x - a.x)
  if (Math.abs(a.y - b.y) < 1) {
    // Same lane: a dip into the middle, deeper for longer reaches.
    const towardMiddle = a.y === lanes.user ? 1 : -1
    const depth = Math.min((lanes.delphi - lanes.user) * 0.75, 16 + dx * 0.16)
    const my = a.y + towardMiddle * depth
    return `M${a.x},${a.y} C${a.x + dx * 0.15},${my} ${b.x - dx * 0.15},${my} ${b.x},${b.y}`
  }
  // Across: an S-bend from one lane to the other.
  const pull = Math.max(24, dx * 0.5)
  return `M${a.x},${a.y} C${a.x + pull},${a.y} ${b.x - pull},${b.y} ${b.x},${b.y}`
}
