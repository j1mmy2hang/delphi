import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { frameFor, layout, RING, type Box, type Frame, type Point } from '../graph/layout'
import type { Layer, MapNode, ThoughtGraph } from '../graph/types'

/**
 * Depth is the map's one visual variable: the deeper a thought, the larger,
 * bolder and warmer it is drawn. The surface is quiet; the core is the
 * brightest thing on the page.
 */
const LOOK: Record<Layer, { size: number; weight: number; dot: number; ink: string }> = {
  surface: { size: 12.5, weight: 400, dot: 2.5, ink: 'var(--muted-foreground)' },
  reaction: { size: 13.5, weight: 400, dot: 3, ink: 'var(--foreground)' },
  belief: { size: 14.5, weight: 500, dot: 3.5, ink: 'var(--foreground)' },
  core: { size: 17, weight: 600, dot: 0, ink: 'var(--foreground)' },
}
const COLOR: Record<Layer, string> = {
  surface: 'var(--map-surface)',
  reaction: 'var(--map-reaction)',
  belief: 'var(--map-belief)',
  core: 'var(--map-core)',
}
const WAS_SIZE = 11
const FRONTIER_SIZE = 15
const TWEEN_MS = 900

let measurer: CanvasRenderingContext2D | null = null
const textWidth = (text: string, size: number, weight: number, family: string, italic = false) => {
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * size
  measurer.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`
  return measurer.measureText(text).width
}

/** The footprint the layout keeps clear for a node: dot, label, and the old label under it. */
const boxOf = (node: MapNode, was: string | undefined, sans: string): Box => {
  const look = LOOK[node.layer]
  const label = textWidth(node.label, look.size, look.weight, sans, isReading(node)) + (look.dot ? look.dot * 2 + 6 : 0)
  const old = was ? textWidth(was, WAS_SIZE, 400, sans) : 0
  return { w: Math.max(label, old) + 6, h: look.size + 8 + (was ? WAS_SIZE + 4 : 0) }
}

/** Delphi's reading of the user, not yet theirs: drawn hollow and in italics. */
const isReading = (node: MapNode) => node.by === 'delphi'

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Glides every node from where it's drawn to where the layout puts it. New
 * nodes start at the node they grew from, so the map visibly grows outward
 * from what's already there. When the canvas itself changed size, what's
 * shown is first carried into the new frame, so it glides only by what the
 * new layout changed.
 */
const useGlide = (
  target: Map<string, Point>,
  origins: Map<string, Point>,
  canvas: Frame,
  instant: boolean,
) => {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const shownIn = useRef(canvas)

  useEffect(() => {
    const scale = { x: canvas.rx / shownIn.current.rx, y: canvas.ry / shownIn.current.ry }
    shownIn.current = canvas
    const from = new Map<string, Point>()
    for (const [id, to] of target) {
      const shown = shownRef.current.get(id)
      from.set(id, shown ? { x: shown.x * scale.x, y: shown.y * scale.y } : (origins.get(id) ?? to))
    }
    // Kept at once, so an update that lands before the first frame starts
    // from here too, not from positions in the old frame.
    shownRef.current = from
    if (instant) {
      setShown(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = easeOut(Math.min(1, (now - start) / TWEEN_MS))
      const next = new Map<string, Point>()
      for (const [id, to] of target) {
        const a = from.get(id) ?? to
        next.set(id, { x: a.x + (to.x - a.x) * t, y: a.y + (to.y - a.y) * t })
      }
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // `origins` is derived from the same change as `target`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, instant])

  return shown
}

/** A slight arc, bowed toward the centre. */
const arc = (a: Point, b: Point) => {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  return `M${a.x},${a.y} Q${mx * 0.88},${my * 0.88} ${b.x},${b.y}`
}

/**
 * Where a node's dot sits, relative to its centre: the row is dot, gap,
 * label, centred as a whole. Edges meet the dot, never the words. The core has
 * no dot; edges meet it at the centre, under its glow.
 */
const dotOffset = (node: MapNode, was: string | undefined, sans: string): Point => {
  const look = LOOK[node.layer]
  if (!look.dot) return { x: 0, y: 0 }
  const row = textWidth(node.label, look.size, look.weight, sans, isReading(node)) + look.dot * 2 + 6
  return { x: -row / 2 + look.dot, y: was ? -(WAS_SIZE + 4) / 2 : 0 }
}

interface ThoughtMapProps {
  graph: ThoughtGraph
  was: Record<string, string>
  width: number
  height: number
  /** The arrangement around the rings. A new one lays the map out afresh. */
  seed: number
}

export const ThoughtMap = ({ graph, was, width: outerWidth, height: outerHeight, seed }: ThoughtMapProps) => {
  // A big panel (the map expanded) draws the same map larger rather than
  // sparser: everything is laid out on a smaller canvas and scaled up.
  const zoom = Math.min(1.4, Math.max(1, Math.min(outerWidth / 820, outerHeight / 520)))
  const width = outerWidth / zoom
  const height = outerHeight / zoom
  const reduceMotion = useReducedMotion() ?? false
  const [hovered, setHovered] = useState<string | null>(null)
  const sans = useMemo(() => getComputedStyle(document.body).fontFamily, [])
  const serif = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--font-serif') || 'Georgia, serif',
    [],
  )

  const frame = useMemo(() => frameFor(width, height), [width, height])
  const core = graph.nodes.find((n) => n.layer === 'core')
  // The centre is held by the core once it's reached, and until then by the
  // question the user is circling.
  const frontier = !core && graph.frontier ? graph.frontier : ''
  const frontierBox = useMemo<Box | null>(
    () =>
      frontier
        ? { w: textWidth(frontier, FRONTIER_SIZE, 400, serif, true) + 24, h: FRONTIER_SIZE + 22 }
        : null,
    [frontier, serif],
  )

  // Positions persist across updates, so the layout only nudges what's there.
  const placed = useRef(new Map<string, Point>())
  const placedWith = useRef(seed)
  const { target, origins } = useMemo(() => {
    const boxes = new Map(graph.nodes.map((n) => [n.id, boxOf(n, was[n.id], sans)]))
    // Reshuffled: start over from the new arrangement, not from where things
    // are. They still glide there from where they're drawn.
    const reshuffled = placedWith.current !== seed
    placedWith.current = seed
    const previous = reshuffled ? new Map<string, Point>() : placed.current
    const target = layout(graph, boxes, previous, frame, frontierBox, seed)
    // Where a new node grows from: the node it's linked to, if that was here.
    const origins = new Map<string, Point>()
    for (const n of graph.nodes) {
      if (previous.has(n.id)) continue
      const parent = graph.edges
        .map((e) => (e.from === n.id ? e.to : e.to === n.id ? e.from : null))
        .find((id) => id && previous.has(id))
      const p = parent ? previous.get(parent) : undefined
      const to = target.get(n.id)!
      origins.set(n.id, p ?? { x: to.x * 1.12, y: to.y * 1.12 })
    }
    placed.current = target
    return { target, origins }
  }, [graph, was, frame, frontierBox, sans, seed])

  const pos = useGlide(target, origins, frame, reduceMotion)

  // Ripples mark what changed in this update: a new thought, or a revised one.
  const seenLabels = useRef(new Map<string, string>())
  const [ripples, setRipples] = useState<{ id: string; key: number }[]>([])
  useEffect(() => {
    const changed = graph.nodes
      .filter((n) => seenLabels.current.get(n.id) !== n.label)
      .map((n) => ({ id: n.id, key: Date.now() + Math.random() }))
    // The first drawing of a reopened map isn't news.
    if (seenLabels.current.size > 0 && changed.length) setRipples(changed)
    seenLabels.current = new Map(graph.nodes.map((n) => [n.id, n.label]))
  }, [graph])

  const neighbours = useMemo(() => {
    if (!hovered) return null
    const set = new Set([hovered])
    for (const e of graph.edges) {
      if (e.from === hovered) set.add(e.to)
      if (e.to === hovered) set.add(e.from)
    }
    return set
  }, [hovered, graph.edges])

  const dim = (id: string) => (neighbours && !neighbours.has(id) ? 0.22 : 1)

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes])
  const anchor = (id: string): Point | null => {
    const p = pos.get(id)
    const n = byId.get(id)
    if (!p || !n) return null
    const o = dotOffset(n, was[id], sans)
    return { x: p.x + o.x, y: p.y + o.y }
  }

  return (
    <svg
      width={outerWidth}
      height={outerHeight}
      viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}
      className="block select-none"
      role="img"
      aria-label={`Thought map: ${graph.nodes.map((n) => n.label).join(', ')}`}
    >
      <defs>
        <radialGradient id="map-core-glow">
          <stop offset="0%" stopColor="var(--map-core)" stopOpacity="0.38" />
          <stop offset="55%" stopColor="var(--map-core)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--map-core)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The rings: surface outermost, each one in a layer deeper. */}
      {(['surface', 'reaction', 'belief'] as const).map((layer) => (
        <ellipse
          key={layer}
          cx={0}
          cy={0}
          rx={frame.rx * RING[layer]}
          ry={frame.ry * RING[layer]}
          fill="none"
          stroke="var(--map-ring)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray="0.5 5" 
        />
      ))}

      {/* The centre: a glow that blooms when the core is reached. */}
      <AnimatePresence>
        {core && (
          <motion.circle
            key="glow"
            cx={0}
            cy={0}
            r={Math.min(frame.ry * 0.34, 70)}
            fill="url(#map-core-glow)"
            initial={{ scale: 0, opacity: 0 }}
            animate={
              reduceMotion
                ? { scale: 1, opacity: 1 }
                : { scale: [1, 1.08, 1], opacity: 1, transition: { scale: { duration: 5, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 1.2 } } }
            }
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </AnimatePresence>

      {/* Until then, the question at the centre, waiting. */}
      <AnimatePresence mode="wait">
        {frontier && (
          <motion.g
            key={frontier}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.ellipse
              cx={0}
              cy={0}
              rx={(frontierBox?.w ?? 80) / 2 + 6}
              ry={(frontierBox?.h ?? 30) / 2 + 2}
              fill="none"
              stroke="var(--map-core)"
              strokeOpacity={0.55}
              strokeWidth={1}
              strokeDasharray="3 4"
              animate={reduceMotion ? undefined : { strokeDashoffset: [0, -14] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
            />
            <text
              x={0}
              y={0}
              dy="0.35em"
              textAnchor="middle"
              fontFamily={serif}
              fontStyle="italic"
              fontSize={FRONTIER_SIZE}
              fill="var(--muted-foreground)"
            >
              {frontier}
            </text>
          </motion.g>
        )}
      </AnimatePresence>

      {/* Edges, under the labels. New ones draw themselves in. */}
      <g fill="none">
        <AnimatePresence>
          {graph.edges.map((e) => {
            const a = anchor(e.from)
            const b = anchor(e.to)
            if (!a || !b) return null
            const tension = e.kind === 'tension'
            const opacity = Math.min(dim(e.from), dim(e.to))
            return (
              <motion.path
                key={`${e.from}-${e.to}`}
                d={arc(a, b)}
                stroke={tension ? 'var(--map-tension)' : 'var(--muted-foreground)'}
                strokeWidth={tension ? 1.25 : 1}
                strokeDasharray={tension ? '4 4' : undefined}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  pathLength: 1,
                  opacity: (tension ? 0.75 : 0.32) * opacity,
                  ...(tension && !reduceMotion ? { strokeDashoffset: [0, -16] } : {}),
                }}
                exit={{ opacity: 0 }}
                transition={{
                  pathLength: { duration: 0.9, delay: 0.35, ease: 'easeInOut' },
                  opacity: { duration: 0.4 },
                  strokeDashoffset: { duration: 1.6, repeat: Infinity, ease: 'linear' },
                }}
              />
            )
          })}
        </AnimatePresence>
      </g>

      {/* Ripples on what just changed. */}
      {!reduceMotion &&
        ripples.map(({ id, key }) => {
          const p = pos.get(id)
          const node = graph.nodes.find((n) => n.id === id)
          if (!p || !node) return null
          return (
            <motion.circle
              key={key}
              cx={p.x}
              cy={p.y}
              r={14}
              fill="none"
              stroke={COLOR[node.layer]}
              strokeWidth={1.5}
              initial={{ scale: 0.4, opacity: 0.9 }}
              animate={{ scale: 3.2, opacity: 0 }}
              transition={{ duration: 1.6, delay: 0.5, ease: 'easeOut' }}
            />
          )
        })}

      {/* The thoughts. */}
      <AnimatePresence>
        {graph.nodes.map((n) => {
          const p = pos.get(n.id)
          if (!p) return null
          const look = LOOK[n.layer]
          const old = was[n.id]
          const textX = look.dot ? (look.dot * 2 + 6) / 2 : 0
          return (
            <motion.g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: dim(n.id) }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              transition={{ duration: 0.6, delay: 0.25 }}
              onPointerEnter={() => setHovered(n.id)}
              onPointerLeave={() => setHovered(null)}
              style={{ cursor: 'default' }}
            >
              {look.dot > 0 && (
                <circle
                  cx={dotOffset(n, old, sans).x}
                  cy={dotOffset(n, old, sans).y}
                  r={look.dot}
                  fill={isReading(n) ? 'var(--background)' : COLOR[n.layer]}
                  stroke={isReading(n) ? COLOR[n.layer] : 'none'}
                  strokeWidth={1.25}
                />
              )}
              <AnimatePresence mode="popLayout">
                <motion.text
                  key={n.label}
                  x={textX}
                  y={old ? -(WAS_SIZE + 4) / 2 : 0}
                  dy="0.35em"
                  textAnchor="middle"
                  fontSize={look.size}
                  fontWeight={look.weight}
                  fontStyle={isReading(n) ? 'italic' : undefined}
                  fill={look.ink}
                  stroke="var(--background)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  {n.label}
                </motion.text>
              </AnimatePresence>
              {old && (
                // What it used to say, struck through: the revision itself.
                <g opacity={0.85}>
                  <text
                    x={textX}
                    y={(look.size + 4) / 2 + 2}
                    dy="0.35em"
                    textAnchor="middle"
                    fontSize={WAS_SIZE}
                    fill="var(--muted-foreground)"
                    stroke="var(--background)"
                    strokeWidth={4}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {old}
                  </text>
                  <line
                    x1={textX - textWidth(old, WAS_SIZE, 400, sans) / 2 - 1}
                    x2={textX + textWidth(old, WAS_SIZE, 400, sans) / 2 + 1}
                    y1={(look.size + 4) / 2 + 2}
                    y2={(look.size + 4) / 2 + 2}
                    stroke="var(--muted-foreground)"
                    strokeWidth={1}
                  />
                </g>
              )}
              <title>
                {(old ? `${n.label} (was: ${old})` : n.label) + (isReading(n) ? ' — what Delphi saw' : '')}
              </title>
            </motion.g>
          )
        })}
      </AnimatePresence>
    </svg>
  )
}
