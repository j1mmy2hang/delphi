import type { Layer, ThoughtGraph } from './types'

/**
 * Where each ring sits, as a fraction of the outermost one. The rings are
 * ellipses, wider than tall like an eye, so a landscape panel is used fully.
 */
export const RING: Record<Layer, number> = { surface: 1, reaction: 0.73, belief: 0.47, core: 0 }

export interface Point {
  x: number
  y: number
}

export interface Box {
  /** The footprint of a node — dot, label, old label — centred on its point. */
  w: number
  h: number
}

export interface Frame {
  /** Half-axes of the outermost ring. */
  rx: number
  ry: number
  width: number
  height: number
}

/** Ring sizes for a viewport, leaving room for labels around the edge. */
export const frameFor = (width: number, height: number): Frame => {
  const ry = Math.max(60, height / 2 - 26)
  const rx = Math.max(80, Math.min(width / 2 - 80, ry * 1.9))
  return { rx, ry, width, height }
}

const TAU = Math.PI * 2

/** Signed angle from a to b, in (-π, π]. */
const turn = (a: number, b: number) => {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d <= -Math.PI) d += TAU
  return d
}

/** Angle of a point on the ellipse, in the ellipse's own (circular) terms. */
const angleAt = (p: Point, frame: Frame) => Math.atan2(p.y / frame.ry, p.x / frame.rx)

/**
 * A fixed hash, so a node with nothing to go on still gets a stable angle; the
 * seed picks a different arrangement. Mixed well (FNV-1a, then an avalanche
 * finish), so n1, n2, n3 land far apart rather than in a clump.
 */
const hashAngle = (id: string, seed: number) => {
  let h = (2166136261 ^ seed) >>> 0
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h = (h ^ (h >>> 16)) >>> 0
  return (h / 2 ** 32) * TAU
}

interface Body {
  id: string
  ring: number
  theta: number
  w: number
  h: number
  x: number
  y: number
}

const overlap = (a: Body, b: Body, pad: number) => {
  const ox = (a.w + b.w) / 2 + pad - Math.abs(a.x - b.x)
  const oy = (a.h + b.h) / 2 + pad - Math.abs(a.y - b.y)
  return ox > 0 && oy > 0 ? Math.min(ox, oy) : 0
}

/**
 * Places every thought on its ring. Depth is never negotiable — a node sits
 * exactly on the ring of its layer — so the layout only chooses angles:
 * thoughts spread evenly around their ring, linked thoughts lean toward each
 * other, and labels that would collide are pushed apart.
 *
 * Nodes already on screen start from their angle, so an update moves them as
 * little as it can; a new node starts beside a thought it's linked to.
 * `centre` is the footprint of whatever holds the middle without being a
 * node (the open question), so nothing lands on it.
 */
export const layout = (
  graph: ThoughtGraph,
  boxes: Map<string, Box>,
  previous: Map<string, Point>,
  frame: Frame,
  centre: Box | null,
  /** Picks the arrangement for nodes with no position yet. */
  seed = 0,
): Map<string, Point> => {
  const neighbours = (id: string) =>
    graph.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []))

  const bodies: Body[] = graph.nodes.map((n, i) => {
    const box = boxes.get(n.id) ?? { w: 60, h: 20 }
    const seen = previous.get(n.id)
    const anchor = neighbours(n.id)
      .map((id) => previous.get(id))
      .find(Boolean)
    const theta = seen
      ? angleAt(seen, frame)
      : anchor
        ? angleAt(anchor, frame) + (i % 2 ? 0.5 : -0.5)
        : hashAngle(n.id, seed)
    return { id: n.id, ring: RING[n.layer], theta, w: box.w, h: box.h, x: 0, y: 0 }
  })

  const place = (b: Body) => {
    b.x = frame.rx * b.ring * Math.cos(b.theta)
    b.y = frame.ry * b.ring * Math.sin(b.theta)
  }

  const index = new Map(bodies.map((b, i) => [b.id, i]))
  const links = graph.edges
    .map((e) => [index.get(e.from), index.get(e.to), e.kind === 'tension'] as const)
    .filter((l): l is readonly [number, number, boolean] => l[0] !== undefined && l[1] !== undefined)

  const orbiting = bodies.filter((b) => b.ring > 0)
  const middle: Body | null = centre ? { id: '', ring: 0, theta: 0, ...centre, x: 0, y: 0 } : null
  const core = bodies.find((b) => b.ring === 0) ?? middle

  // Relax angles. Steps shrink as it settles, so it converges rather than
  // jitters, and a warm start (an update) needs less of it.
  const rounds = previous.size ? 220 : 400
  for (let round = 0; round < rounds; round++) {
    const heat = 0.06 * (1 - round / rounds) + 0.004
    const push = new Map<Body, number>()
    const add = (b: Body, d: number) => push.set(b, (push.get(b) ?? 0) + d)

    for (let i = 0; i < orbiting.length; i++) {
      for (let j = i + 1; j < orbiting.length; j++) {
        const a = orbiting[i]
        const b = orbiting[j]
        const d = turn(a.theta, b.theta)
        // Thoughts on the same ring spread out the most; across rings, less.
        const kin = 1 / (1 + 4 * Math.abs(a.ring - b.ring))
        const f = (kin * 0.35) / (Math.abs(d) + 0.15)
        add(a, -Math.sign(d || 1) * f)
        add(b, Math.sign(d || 1) * f)
      }
    }

    // Linked thoughts lean together. Thoughts in tension are pulled apart,
    // so the red line between them stretches across the map.
    for (const [i, j, tension] of links) {
      const a = bodies[i]
      const b = bodies[j]
      if (a.ring === 0 || b.ring === 0) continue
      const d = turn(a.theta, b.theta)
      if (tension) {
        const f = 0.25 * (Math.PI - Math.abs(d)) / Math.PI
        add(a, -Math.sign(d || 1) * f)
        add(b, Math.sign(d || 1) * f)
      } else {
        add(a, d * 0.12)
        add(b, -d * 0.12)
      }
    }

    for (const b of orbiting) b.theta += Math.max(-0.3, Math.min(0.3, (push.get(b) ?? 0) * heat * 4))
    for (const b of orbiting) place(b)

    // Labels that touch push apart around the ring, and off the centre.
    for (let i = 0; i < orbiting.length; i++) {
      for (let j = i + 1; j < orbiting.length; j++) {
        const a = orbiting[i]
        const b = orbiting[j]
        if (!overlap(a, b, 6)) continue
        const d = turn(a.theta, b.theta)
        const nudge = 0.04 / Math.max(a.ring, b.ring, 0.3)
        a.theta -= Math.sign(d || 1) * nudge
        b.theta += Math.sign(d || 1) * nudge
      }
      if (core && overlap(orbiting[i], core, 8)) {
        // Slide toward the ring's widest point, where there's room beside it.
        const b = orbiting[i]
        b.theta += Math.sin(2 * b.theta) >= 0 ? -0.04 : 0.04
      }
    }
  }

  // Whatever still collides can step off its ring a little, never far.
  for (const b of orbiting) place(b)
  const fixed = [...bodies.filter((b) => b.ring === 0), ...(middle ? [middle] : [])]
  for (let round = 0; round < 60; round++) {
    const all = [...orbiting, ...fixed]
    for (let i = 0; i < orbiting.length; i++) {
      for (let j = 0; j < all.length; j++) {
        const a = orbiting[i]
        const b = all[j]
        if (a === b) continue
        const o = overlap(a, b, 4)
        if (!o) continue
        const dy = a.y - b.y || (i % 2 ? 1 : -1)
        a.y += Math.sign(dy) * Math.min(o, 3) * (fixed.includes(b) ? 1 : 0.5)
      }
    }
  }

  const out = new Map<string, Point>()
  for (const b of bodies) {
    const hw = frame.width / 2 - b.w / 2 - 6
    const hh = frame.height / 2 - b.h / 2 - 4
    out.set(b.id, {
      x: Math.max(-hw, Math.min(hw, b.x)),
      y: Math.max(-hh, Math.min(hh, b.y)),
    })
  }
  return out
}
