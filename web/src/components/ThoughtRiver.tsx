import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { layoutRiver, linkPath, LABEL_SIZE, LINE_HEIGHT, type Point } from '../river/layout'
import type { Move, River } from '../river/types'

const GLIDE_MS = 600

let measurer: CanvasRenderingContext2D | null = null
// Labels are measured on every layout, and while the panel resizes that's
// every frame: remember what's been measured.
const widths = new Map<string, number>()
const textWidth = (text: string, size: number, weight: number, family: string) => {
  const key = `${weight} ${size}px ${family}|${text}`
  const known = widths.get(key)
  if (known !== undefined) return known
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * size
  measurer.font = `${weight} ${size}px ${family}`
  const width = measurer.measureText(text).width
  widths.set(key, width)
  return width
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Glides moves from where they're drawn to where the layout now puts them —
 * when the river grows past the view and closes up, or the panel resizes.
 * New moves appear where they belong.
 */
const useGlide = (target: Map<string, Point>, instant: boolean) => {
  // What's on screen. State only to re-render while gliding; instant moves
  // render the target directly, without a second render to copy it over.
  const [, setFrame] = useState(0)
  const shownRef = useRef(target)

  useEffect(() => {
    if (instant) {
      shownRef.current = target
      return
    }
    const from = new Map<string, Point>()
    for (const [id, to] of target) from.set(id, shownRef.current.get(id) ?? to)
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = easeOut(Math.min(1, (now - start) / GLIDE_MS))
      const next = new Map<string, Point>()
      for (const [id, to] of target) {
        const a = from.get(id) ?? to
        next.set(id, { x: a.x + (to.x - a.x) * t, y: a.y + (to.y - a.y) * t })
      }
      shownRef.current = next
      setFrame((n) => n + 1)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, instant])

  return instant ? target : shownRef.current
}

/**
 * What a move grew from: what it rests on, and what those rest on. Two steps
 * back, not all the way: nearly everything in a conversation leads to
 * everything after it, so the whole lineage would light up the whole river.
 */
const lineageOf = (id: string, byId: Map<string, Move>): Set<string> => {
  // What it grew from includes any position it replaced.
  const replaced = [...byId.values()].filter((m) => m.revisedBy === id).map((m) => m.id)
  const seen = new Set([id, ...replaced])
  let frontier = [id, ...replaced]
  for (let hop = 0; hop < 2; hop++) {
    frontier = frontier.flatMap((m) => (byId.get(m)?.rests ?? []).map((r) => r.on)).filter((m) => !seen.has(m))
    for (const m of frontier) seen.add(m)
  }
  return seen
}

interface ThoughtRiverProps {
  river: River
  /** The visible area; the river can be wider, and scrolls. */
  width: number
  height: number
  selected: string | null
  onSelect: (id: string | null) => void
  /** Follow the layout without gliding (the panel is resizing). */
  instant?: boolean
}

export const ThoughtRiver = ({ river, width: viewWidth, height: viewHeight, selected, onSelect, instant = false }: ThoughtRiverProps) => {
  const reduceMotion = useReducedMotion() ?? false
  const [hovered, setHovered] = useState<string | null>(null)
  const sans = useMemo(() => getComputedStyle(document.body).fontFamily, [])

  // Expanded, the same river is drawn larger rather than sparser.
  const zoom = Math.min(1.3, Math.max(1, Math.min(viewWidth / 820, viewHeight / 520)))
  const view = { width: viewWidth / zoom, height: viewHeight / zoom }

  const { moves } = river
  const layout = useMemo(
    () => layoutRiver(moves, river.upTo, view, (t) => textWidth(t, LABEL_SIZE, 400, sans)),
    // `view` is derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moves, river.upTo, view.width, view.height, sans],
  )
  const target = useMemo(
    () => new Map([...layout.placed].map(([id, p]) => [id, { x: p.x, y: p.y }])),
    [layout],
  )
  const pos = useGlide(target, reduceMotion || instant)

  const byId = useMemo(() => new Map(moves.map((m) => [m.id, m])), [moves])
  // How many later moves rest on each: what carried the river gets drawn larger.
  const weight = useMemo(() => {
    const w = new Map<string, number>()
    for (const m of moves) for (const r of m.rests) w.set(r.on, (w.get(r.on) ?? 0) + 1)
    return w
  }, [moves])
  // Each move's place in order, to tell a link to the move just before (the
  // conversation simply going on) from one that reaches back.
  const order = useMemo(() => new Map(moves.map((m, i) => [m.id, i])), [moves])

  // Moves that feed a realization: their links are drawn in its colour.
  const feeds = useMemo(() => {
    const f = new Set<string>()
    for (const m of moves) if (m.kind === 'realization') for (const r of m.rests) f.add(`${r.on}>${m.id}`)
    return f
  }, [moves])

  // Hover shows a move's neighbours; a selection traces everything it rests on.
  const lineage = useMemo(() => (selected ? lineageOf(selected, byId) : null), [selected, byId])
  const neighbours = useMemo(() => {
    if (!hovered || lineage) return null
    const n = new Set([hovered])
    for (const r of byId.get(hovered)?.rests ?? []) n.add(r.on)
    for (const m of moves) if (m.rests.some((r) => r.on === hovered) || m.revisedBy === hovered) n.add(m.id)
    const replacement = byId.get(hovered)?.revisedBy
    if (replacement) n.add(replacement)
    return n
  }, [hovered, lineage, byId, moves])
  const focus = lineage ?? neighbours
  const lit = (id: string) => !focus || focus.has(id)

  // The last move, if it's a question left open, pulses: where the river is now.
  const end = moves.at(-1)
  const openEnd = end?.kind === 'question' ? end.id : null

  return (
    <svg
      width={layout.width * zoom}
      height={viewHeight}
      viewBox={`0 0 ${layout.width} ${view.height}`}
      className="block select-none"
      role="img"
      aria-label={`Thought river: ${moves.map((m) => m.label).join(', ')}`}
      onClick={() => onSelect(null)}
    >
      <defs>
        <radialGradient id="river-glow">
          <stop offset="0%" stopColor="var(--river-gold)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--river-gold)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The two lanes. */}
      {(['user', 'delphi'] as const).map((lane) => (
        <line
          key={lane}
          x1={0}
          x2={layout.width}
          y1={layout.lanes[lane]}
          y2={layout.lanes[lane]}
          stroke="var(--river-lane)"
          strokeWidth={1}
        />
      ))}

      {/* Links, from what a move rests on to the move. */}
      <g fill="none">
        {moves.flatMap((m) =>
          m.rests.map((r) => {
            const a = pos.get(r.on)
            const b = pos.get(m.id)
            if (!a || !b) return null
            const key = `${r.on}>${m.id}`
            const inLineage = lineage?.has(m.id) && lineage.has(r.on)
            const gold = inLineage || (!lineage && feeds.has(key))
            const on = focus ? focus.has(m.id) && focus.has(r.on) : true
            // The conversation going on from one move to the next is the
            // river's current, drawn faintly; what reaches back is its shape.
            const adjacent = (order.get(m.id) ?? 0) - (order.get(r.on) ?? 0) === 1
            return (
              <motion.path
                key={key}
                d={linkPath(a, b, layout.lanes)}
                stroke={gold ? 'var(--river-gold)' : 'var(--river-line)'}
                strokeWidth={gold ? 1.4 : adjacent ? 0.8 : 1.1}
                strokeDasharray={r.how === 'challenges' ? '4 3' : undefined}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: on ? (gold ? 0.9 : adjacent && !focus ? 0.35 : 0.85) : 0.1 }}
                transition={{ pathLength: { duration: 0.8, ease: 'easeOut' }, opacity: { duration: 0.3 } }}
              />
            )
          }),
        )}
        {/* A position let go of, joined by a dotted line to what replaced it. */}
        {moves.map((m) => {
          const a = pos.get(m.id)
          const b = m.revisedBy ? pos.get(m.revisedBy) : undefined
          if (!a || !b || !m.revisedBy) return null
          const on = focus ? focus.has(m.id) && focus.has(m.revisedBy) : true
          return (
            <motion.path
              key={`revised:${m.id}`}
              d={linkPath(a, b, layout.lanes)}
              stroke="var(--muted-foreground)"
              strokeWidth={1.1}
              strokeDasharray="1 3.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: on ? 0.7 : 0.1 }}
              transition={{ pathLength: { duration: 1.2, ease: 'easeOut' }, opacity: { duration: 0.3 } }}
            />
          )
        })}
      </g>

      {/* The moves. */}
      {moves.map((m) => {
        const p = pos.get(m.id)
        const at = layout.placed.get(m.id)
        if (!p || !at) return null
        const realization = m.kind === 'realization'
        const isSelected = selected === m.id
        // Let go of: still on the river, as a record of the turn, but faded.
        const revised = !!m.revisedBy && !isSelected
        const r = realization ? 6 : m.kind === 'question' ? 4 : 2.5 + Math.min(3, (weight.get(m.id) ?? 0) * 0.6)
        const ink = realization || isSelected ? 'var(--foreground)' : 'var(--muted-foreground)'
        return (
          <motion.g
            key={m.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: lit(m.id) ? (revised ? 0.45 : 1) : 0.18 }}
            transition={{ duration: 0.4 }}
            onPointerEnter={() => setHovered(m.id)}
            onPointerLeave={() => setHovered(null)}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(isSelected ? null : m.id)
            }}
            style={{ cursor: 'pointer' }}
          >
            {/* A wider, invisible target than the dot itself. */}
            <circle cx={p.x} cy={p.y} r={12} fill="transparent" data-move={m.id} />
            {realization && <circle cx={p.x} cy={p.y} r={22} fill="url(#river-glow)" />}

            {m.id === openEnd && !reduceMotion && (
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                initial={{ opacity: 0.6, scale: 1 }}
                animate={{ opacity: 0, scale: 2.6 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
            )}
            {m.kind === 'evidence' ? (
              <rect
                x={p.x - 3}
                y={p.y - 3}
                width={6}
                height={6}
                transform={`rotate(45 ${p.x} ${p.y})`}
                fill="var(--muted-foreground)"
              />
            ) : (
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={realization ? 'var(--river-gold)' : m.kind === 'question' ? 'var(--background)' : 'var(--foreground)'}
                stroke={m.kind === 'question' ? 'var(--foreground)' : 'none'}
                strokeWidth={1.2}
                opacity={realization ? 1 : 0.85}
              />
            )}
            {/* A hairline from the label to its dot, so a label in the far row is still clearly this move's. */}
            <line
              x1={p.x}
              x2={p.x}
              y1={m.by === 'user' ? at.labelY + (at.lines.length - 0.5) * LINE_HEIGHT : at.labelY - LINE_HEIGHT / 2}
              y2={m.by === 'user' ? p.y - r - 3 : p.y + r + 3}
              stroke="var(--river-lane)"
              strokeWidth={1}
            />
            <text
              x={p.x}
              y={at.labelY + (p.y - at.y)}
              textAnchor="middle"
              fontSize={LABEL_SIZE}
              fontWeight={realization || isSelected ? 600 : 400}
              fill={ink}
              stroke="var(--background)"
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {at.lines.map((line, k) => (
                <tspan key={k} x={p.x} dy={k === 0 ? '0.35em' : LINE_HEIGHT}>
                  {line}
                </tspan>
              ))}
            </text>
            <title>{m.label}</title>
          </motion.g>
        )
      })}
    </svg>
  )
}
