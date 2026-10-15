import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
// The thought river: a second, cheap model reads the conversation and returns
// the moves that carried its thinking — questions, claims, examples,
// realizations — each linked back to what it rests on. It runs beside the
// chat and never touches it; chat.mts is unchanged. Spend is billed to the
// same allowance as the chat, so the river can't be used to get around it.
//
// Two speeds. Each exchange, a cheap draw reads the messages since the last
// one and returns moves for those alone; the server appends them, so what's
// already drawn never shifts. Every few exchanges — and whenever Delphi steps
// back to sum up — a reflection reads the whole conversation with the whole
// river and returns edits: links back to early moves, realizations,
// merges, positions let go, and one line on what the river shows. The server
// checks every edit; the river never loses its order or its record of turns.
// ─────────────────────────────────────────────────────────────────────────────

/** OpenRouter's moving alias for the newest Gemini Flash. */
const MODEL = "~google/gemini-flash-latest"

/** A first drawing of a long conversation can run to a few dozen moves. */
const MAX_OUTPUT_TOKENS = 6000
/** A reflection returns edits, not the whole river. */
const REFLECT_OUTPUT_TOKENS = 6000

/** Same allowances as chat.mts — keep in sync. */
const FREE_BUDGET_USD = Number(Netlify.env.get("FREE_BUDGET_USD") ?? "0.5")
const PAID_BUDGET_USD = Number(Netlify.env.get("PAID_BUDGET_USD") ?? "2")
const DAILY_IP_BUDGET_USD = Number(Netlify.env.get("DAILY_IP_BUDGET_USD") ?? "0.5")
const FALLBACK_PRICE_PER_MTOK = { input: 1, output: 4 }

/**
 * Input guards. Unlike chat, a long conversation is never refused: the model
 * reads the opening and the most recent stretch that fits, and the river
 * already holds the moves from the middle.
 */
const MAX_MESSAGES = 1_000
const MAX_CHARS_PER_MESSAGE = 8_000
const MAX_TOTAL_CHARS = 48_000 // ~a long evening's talk; ~1¢ per draw at the cap

/** Its own burst window, so drawing the river never eats into the chat's. */
const BURST_LIMIT = { windowSeconds: 60, max: 20 }

const ALLOWED_ORIGINS = ["https://delphi-web.netlify.app"]

/** Hard limits on what reaches the client, whatever the model returns. */
const MAX_MOVES = 80
const MAX_RESTS = 3
const MAX_LABEL_CHARS = 48
const MAX_TITLE_CHARS = 48

/**
 * How many realizations a river may hold: a few, so each one means something.
 * Three for a short talk, up to five for a long one.
 */
const realizationBudget = (messages: number) => (messages <= 20 ? 3 : messages <= 40 ? 4 : 5)
const realizationsIn = (moves: Move[]) => moves.filter((m) => m.kind === "realization").length
const MAX_INSIGHT_CHARS = 160
/** A move can gain links in reflection beyond what a draw gives it. */
const MAX_RESTS_REFLECTED = 5
/** How much one reflection may change, so the river stays recognisable. */
const MAX_EDITS = { adds: 4, links: 12, kinds: 6, merges: 6, drops: 10, relabels: 10, revisions: 4 }

const SPEAKERS = ["user", "delphi"] as const
const KINDS = ["question", "claim", "evidence", "realization"] as const
const HOWS = ["builds", "answers", "challenges"] as const

// ─────────────────────────────────────────────────────────────────────────────
// Prompt: river-prompt.md, bundled via netlify.toml `included_files`. Re-read
// on every request under `netlify dev`, so an edit applies to the next turn.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const IS_LOCAL_DEV = Netlify.env.get("NETLIFY_DEV") === "true"

const loadPrompt = (name: string): string => {
  const candidates = [
    ...["", "..", "../..", "../../.."].map((up) => resolve(here, up, name)),
    // `netlify dev` started before a prompt was added to included_files
    // doesn't bundle it; read the source instead.
    resolve(process.cwd(), "web", name),
    resolve(process.cwd(), name),
  ]
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf-8")
    } catch {
      // try next
    }
  }
  throw new Error(`${name} not found`)
}

const PROMPTS = { draw: loadPrompt("river-prompt.md"), reflect: loadPrompt("river-reflect-prompt.md") }
const FILES = { draw: "river-prompt.md", reflect: "river-reflect-prompt.md" }
const prompt = (mode: Mode) => (IS_LOCAL_DEV ? loadPrompt(FILES[mode]) : PROMPTS[mode])

// ─────────────────────────────────────────────────────────────────────────────
// Types and the response schema the model is held to
// ─────────────────────────────────────────────────────────────────────────────

type Mode = "draw" | "reflect"
type ChatMessage = { role: "user" | "assistant"; content: string }
type Rest = { on: string; how: (typeof HOWS)[number] }
type Move = {
  id: string
  /** Which message it came from, counting from 1. */
  at: number
  by: (typeof SPEAKERS)[number]
  kind: (typeof KINDS)[number]
  label: string
  rests: Rest[]
  /** A position the user let go of: the later move that replaced it. */
  revisedBy?: string
}
/**
 * `upTo`: how many messages the river has read so far; `reflectedAt`: how
 * many it had read at its last reflection; `insight`: what that reflection
 * saw.
 */
type River = { title: string; upTo: number; moves: Move[]; reflectedAt: number; insight: string }

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "moves"],
  properties: {
    title: { type: "string" },
    moves: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "at", "by", "kind", "label", "rests"],
        properties: {
          id: { type: "string" },
          at: { type: "integer" },
          by: { type: "string", enum: SPEAKERS },
          kind: { type: "string", enum: KINDS },
          label: { type: "string" },
          rests: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["on", "how"],
              properties: {
                on: { type: "string" },
                how: { type: "string", enum: HOWS },
              },
            },
          },
        },
      },
    },
  },
}

const idList = { type: "array", items: { type: "string" } }
const edit = (props: Record<string, unknown>) => ({
  type: "array",
  items: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props },
})

const REFLECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "insight", "adds", "links", "kinds", "merges", "drops", "relabels", "revisions"],
  properties: {
    title: { type: "string" },
    insight: { type: "string" },
    adds: SCHEMA.properties.moves,
    links: edit({ from: { type: "string" }, on: { type: "string" }, how: { type: "string", enum: HOWS } }),
    kinds: edit({ id: { type: "string" }, kind: { type: "string", enum: KINDS } }),
    merges: edit({ keep: { type: "string" }, drop: idList, label: { type: "string" } }),
    drops: idList,
    relabels: edit({ id: { type: "string" }, label: { type: "string" } }),
    revisions: edit({ id: { type: "string" }, by: { type: "string" } }),
  },
}

const clip = (s: unknown, n: number) =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : ""

/** A label clipped to `n` characters, at a word break if it has spaces. */
const clipLabel = (s: unknown, n: number) => {
  const whole = clip(s, Infinity)
  if (whole.length <= n) return whole
  const cut = whole.slice(0, n)
  const space = cut.lastIndexOf(" ")
  return space > n / 2 ? cut.slice(0, space) : cut
}

/**
 * Appends moves to a river, keeping only what's well-formed: known kinds and
 * speakers, unique ids, a message number within `from..to`, never earlier
 * than the move before it, and links only to moves already in the river and
 * no later than itself. Used both on the client's previous river (from 1)
 * and on the model's new moves (after what the river has read).
 */
const appendMoves = (river: Move[], input: unknown, from: number, to: number, maxRests = MAX_RESTS): Move[] => {
  const out = [...river]
  const byId = new Map(out.map((m) => [m.id, m]))
  for (const raw of (Array.isArray(input) ? input : []) as Record<string, any>[]) {
    if (out.length >= MAX_MOVES) break
    const id = clip(raw?.id, 24)
    const label = clipLabel(raw?.label, MAX_LABEL_CHARS)
    const at = Number(raw?.at)
    if (!id || !label || byId.has(id) || !Number.isInteger(at) || at < from || at > to) continue
    if (out.length && at < out[out.length - 1].at) continue
    const rests: Rest[] = []
    for (const r of (Array.isArray(raw.rests) ? raw.rests : []) as Record<string, any>[]) {
      const on = byId.get(clip(r?.on, 24))
      if (!on || on.at > at || rests.some((x) => x.on === on.id) || rests.length >= maxRests) continue
      rests.push({ on: on.id, how: HOWS.includes(r.how) ? r.how : "builds" })
    }
    const move: Move = {
      id,
      at,
      by: raw.by === "delphi" ? "delphi" : "user",
      kind: KINDS.includes(raw.kind) ? raw.kind : "claim",
      label,
      rests,
    }
    out.push(move)
    byId.set(id, move)
  }
  return out
}

const sanitizeRiver = (input: unknown, messageCount: number): River => {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const upTo = Math.min(messageCount, Math.max(0, Math.floor(Number(raw.upTo) || 0)))
  const moves = appendMoves([], raw.moves, 1, upTo, MAX_RESTS_REFLECTED)
  // A revision points forward, to a later move by the user.
  const order = new Map(moves.map((m, i) => [m.id, i]))
  const rawMoves = (Array.isArray(raw.moves) ? raw.moves : []) as Record<string, any>[]
  const revisedBy = new Map(rawMoves.map((m) => [clip(m?.id, 24), clip(m?.revisedBy, 24)]))
  for (const [i, m] of moves.entries()) {
    const by = revisedBy.get(m.id)
    if (by && (order.get(by) ?? -1) > i && m.by === "user") m.revisedBy = by
  }
  return {
    title: clip(raw.title, MAX_TITLE_CHARS),
    upTo,
    moves,
    reflectedAt: Math.min(upTo, Math.max(0, Math.floor(Number(raw.reflectedAt) || 0))),
    insight: clip(raw.insight, MAX_INSIGHT_CHARS),
  }
}

/**
 * Applies a reflection's edits to a river, each checked against it: ids must
 * exist, links point back in time, merges join one speaker's moves, and only
 * so many of each are taken. Removing a move passes its links on, so what
 * rested on it still rests on something.
 */
const applyReflection = (river: River, answer: Record<string, any>): River => {
  const take = <T,>(v: unknown, n: number) => (Array.isArray(v) ? (v as T[]).slice(0, n) : [])
  let moves = river.moves.map((m) => ({ ...m, rests: [...m.rests] }))
  const find = (id: unknown) => moves.find((m) => m.id === clip(id, 24))
  const orderOf = () => new Map(moves.map((m, i) => [m.id, i]))

  for (const r of take<Record<string, any>>(answer.relabels, MAX_EDITS.relabels)) {
    const m = find(r?.id)
    const label = clipLabel(r?.label, MAX_LABEL_CHARS)
    if (m && label) m.label = label
  }
  for (const k of take<Record<string, any>>(answer.kinds, MAX_EDITS.kinds)) {
    const m = find(k?.id)
    // Hindsight can find a realization, never take one back: the user may
    // already have seen it light up.
    if (!m || !KINDS.includes(k?.kind) || m.kind === "realization") continue
    if (k.kind === "realization" && realizationsIn(moves) >= realizationBudget(river.upTo)) continue
    m.kind = k.kind
  }

  // Moves the near-sighted draw missed, each slotted in at its message.
  const usedIds = new Set(moves.map((m) => m.id))
  for (const raw of take<Record<string, any>>(answer.adds, MAX_EDITS.adds)) {
    const id = clip(raw?.id, 24)
    const label = clipLabel(raw?.label, MAX_LABEL_CHARS)
    const at = Number(raw?.at)
    if (!id || usedIds.has(id) || !label || !Number.isInteger(at) || at < 1 || at > river.upTo) continue
    let index = moves.length
    while (index > 0 && moves[index - 1].at > at) index--
    const before = new Set(moves.slice(0, index).map((m) => m.id))
    const rests: Rest[] = []
    for (const r of (Array.isArray(raw.rests) ? raw.rests : []) as Record<string, any>[]) {
      const on = clip(r?.on, 24)
      if (!before.has(on) || rests.some((x) => x.on === on) || rests.length >= MAX_RESTS) continue
      rests.push({ on, how: HOWS.includes(r.how) ? r.how : "builds" })
    }
    const kind = KINDS.includes(raw.kind) ? raw.kind : "claim"
    const overBudget = kind === "realization" && realizationsIn(moves) >= realizationBudget(river.upTo)
    moves.splice(index, 0, {
      id,
      at,
      by: raw.by === "delphi" ? "delphi" : "user",
      kind: overBudget ? "claim" : kind,
      label,
      rests,
    })
    usedIds.add(id)
  }

  /** Takes a move out, sending what rested on it to `to` (a move or its own rests). */
  const remove = (id: string, to: string | null) => {
    const gone = moves.find((m) => m.id === id)
    if (!gone) return
    moves = moves.filter((m) => m.id !== id)
    const order = orderOf()
    for (const m of moves) {
      const i = m.rests.findIndex((r) => r.on === id)
      if (i < 0) continue
      const [old] = m.rests.splice(i, 1)
      const heirs = to ? [{ on: to, how: old.how }] : gone.rests
      for (const h of heirs) {
        const ok = (order.get(h.on) ?? Infinity) < (order.get(m.id) ?? -1)
        if (ok && h.on !== m.id && !m.rests.some((r) => r.on === h.on)) m.rests.push({ on: h.on, how: old.how })
      }
      m.rests = m.rests.slice(0, MAX_RESTS_REFLECTED)
    }
    for (const m of moves) if (m.revisedBy === id) m.revisedBy = to ?? undefined
  }

  for (const g of take<Record<string, any>>(answer.merges, MAX_EDITS.merges)) {
    const group = [g?.keep, ...take<unknown>(g?.drop, 10)].map(find).filter((m): m is Move => !!m)
    const unique = [...new Set(group)]
    // One speaker's repeats; or realizations, whoever reached them, that are one insight.
    const sameSpeaker = unique.every((m) => m.by === unique[0].by)
    const realizations = unique.every((m) => m.kind === "realization")
    if (unique.length < 2 || !(sameSpeaker || realizations)) continue
    // The earliest stays, where the thought first appeared.
    const order = orderOf()
    unique.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    const [keep, ...rest] = unique
    const label = clipLabel(g?.label, MAX_LABEL_CHARS)
    if (label) keep.label = label
    if (rest.some((m) => m.kind === "realization")) keep.kind = "realization"
    for (const m of rest) remove(m.id, keep.id)
  }
  for (const id of take<unknown>(answer.drops, MAX_EDITS.drops)) {
    const m = find(id)
    // A realization is never dropped.
    if (m && m.kind !== "realization") remove(m.id, null)
  }

  let order = orderOf()
  for (const l of take<Record<string, any>>(answer.links, MAX_EDITS.links)) {
    const from = find(l?.from)
    const on = find(l?.on)
    if (!from || !on || (order.get(on.id) ?? Infinity) >= (order.get(from.id) ?? -1)) continue
    if (from.rests.some((r) => r.on === on.id) || from.rests.length >= MAX_RESTS_REFLECTED) continue
    from.rests.push({ on: on.id, how: HOWS.includes(l?.how) ? l.how : "builds" })
  }
  order = orderOf()
  for (const r of take<Record<string, any>>(answer.revisions, MAX_EDITS.revisions)) {
    const old = find(r?.id)
    const by = find(r?.by)
    if (old && by && old.by === "user" && (order.get(by.id) ?? -1) > (order.get(old.id) ?? Infinity)) {
      old.revisedBy = by.id
    }
  }

  return {
    title: clip(answer.title, MAX_TITLE_CHARS) || river.title,
    upTo: river.upTo,
    moves,
    reflectedAt: river.upTo,
    insight: clip(answer.insight, MAX_INSIGHT_CHARS) || river.insight,
  }
}

/** Delphi's replies can open with a <situation N> tag; it's for the chat model, not part of what was said. */
const said = (m: ChatMessage) => m.content.replace(/<situation[^>]*>/g, "").trim()

/**
 * What the model reads: the opening message, then as many of the latest as
 * fit — always including every message it's to draw. Messages keep their
 * numbers, so moves can say where they came from.
 */
const transcriptOf = (all: ChatMessage[], from: number): string => {
  const line = (m: ChatMessage, i: number) => `[#${i + 1} ${m.role === "user" ? "USER" : "DELPHI"}]\n${said(m)}`
  let budget = MAX_TOTAL_CHARS - all[0].content.length
  // The messages to draw are always read, unless they alone overflow the
  // budget (a first drawing of a very long conversation); then the latest
  // that fit.
  const fresh = all.slice(from - 1).reduce((n, m) => n + m.content.length, 0)
  const forced = fresh <= budget ? from - 1 : all.length
  let start = all.length
  while (start > 1 && (start - 1 >= forced || all[start - 1].content.length <= budget)) {
    budget -= all[--start].content.length
  }
  const kept = [line(all[0], 0)]
  if (start > 1) kept.push(`[… messages #2–#${start} omitted; the river already holds their moves]`)
  for (let i = start; i < all.length; i++) kept.push(line(all[i], i))
  return kept.join("\n\n")
}

const budgetLine = (moves: Move[], messages: number) => {
  const have = realizationsIn(moves)
  const budget = realizationBudget(messages)
  return have >= budget
    ? `The river already has ${have} realizations, the most a conversation this long gets: add none.`
    : `The river has ${have} of at most ${budget} realizations for a conversation this long; add one only if it's truly earned.`
}

const nextIdOf = (river: River) =>
  river.moves.reduce((n, m) => Math.max(n, Number(m.id.replace(/\D/g, "")) || 0), 0) + 1

/** A reflection's request: the whole conversation (as much as fits) and the whole river. */
const reflectBrief = (all: ChatMessage[], river: River): string =>
  [
    "<conversation>",
    transcriptOf(all, all.length + 1),
    "</conversation>",
    "",
    "<river>",
    JSON.stringify({
      title: river.title,
      insight: river.insight,
      moves: river.moves.map(({ id, at, by, kind, label, rests, revisedBy }) => ({ id, at, by, kind, label, rests, ...(revisedBy ? { revisedBy } : {}) })),
    }),
    "</river>",
    "",
    `Reflect on the river: ${river.moves.length} moves over ${all.length} messages. Any added moves take ids from m${nextIdOf(river)}.`,
    budgetLine(river.moves, all.length),
  ].join("\n")

/** The request as one message: the conversation, the river so far, and what to draw. */
const brief = (all: ChatMessage[], river: River): string => {
  const from = river.upTo + 1
  const count = all.length - river.upTo
  const nextId = nextIdOf(river)
  const sofar = river.moves.map((m) => ({ id: m.id, at: m.at, by: m.by, kind: m.kind, label: m.label }))
  return [
    "<conversation>",
    transcriptOf(all, from),
    "</conversation>",
    "",
    "<river_so_far>",
    JSON.stringify({ title: river.title, moves: sofar }),
    "</river_so_far>",
    "",
    river.moves.length
      ? `Draw the moves in messages #${from}–#${all.length} only. New ids start at m${nextId}.`
      : `Draw the whole conversation, messages #1–#${all.length}. Ids start at m1.`,
    // Left to itself the model boils a conversation down to a few moves; a
    // concrete number keeps the river as full as the talk was.
    `That's ${count} messages: expect about ${Math.max(1, Math.round(count * 0.7))} moves, fewer if they're thin.`,
    budgetLine(river.moves, all.length),
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Gatekeeping — the same rules as chat.mts, kept short. Store hiccups fail open.
// ─────────────────────────────────────────────────────────────────────────────

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const isAuthorized = (req: Request): boolean => {
  const expected = Netlify.env.get("APP_SHARED_TOKEN")
  if (!expected) return true
  const token = req.headers.get("x-app-token")
  if (token && safeEqual(token, expected)) return true
  const source = req.headers.get("origin") ?? req.headers.get("referer") ?? ""
  return ALLOWED_ORIGINS.some((o) => source.startsWith(o))
}

const clientIp = (req: Request): string =>
  req.headers.get("x-nf-client-connection-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown"

/** The same spend record chat.mts bills, so both draw on one allowance. */
const allowanceFor = (req: Request, ip: string): { key: string; budget: number } => {
  const now = new Date().toISOString()
  const device = req.headers.get("x-device-id")?.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64)
  if (device) {
    const budget = req.headers.get("x-tier") === "paid" ? PAID_BUDGET_USD : FREE_BUDGET_USD
    return { key: `${device}:${now.slice(0, 7)}`, budget }
  }
  return { key: `web:${ip}:${now.slice(0, 10)}`, budget: DAILY_IP_BUDGET_USD }
}

const overBurst = async (ip: string): Promise<boolean> => {
  try {
    const store = getStore("ratelimit")
    const bucket = Math.floor(Date.now() / 1000 / BURST_LIMIT.windowSeconds)
    const key = `river:${ip}:${bucket}`
    const current = (await store.get(key, { type: "json" })) as { count: number } | null
    const count = (current?.count ?? 0) + 1
    if (count > BURST_LIMIT.max) return true
    await store.setJSON(key, { count })
    return false
  } catch {
    return false
  }
}

const getSpend = async (key: string): Promise<number> => {
  try {
    const v = (await getStore("spend").get(key, { type: "json" })) as { usd: number } | null
    return v?.usd ?? 0
  } catch {
    return 0
  }
}

const addSpend = async (key: string, usd: number): Promise<void> => {
  if (!(usd > 0)) return
  try {
    const store = getStore("spend")
    const cur = (await store.get(key, { type: "json" })) as { usd: number } | null
    await store.setJSON(key, { usd: (cur?.usd ?? 0) + usd })
  } catch (err) {
    console.error("addSpend failed:", err)
  }
}


const validateMessages = (input: unknown): ChatMessage[] | null => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) return null
  const clean: ChatMessage[] = []
  for (const m of input) {
    const { role, content } = (m ?? {}) as Record<string, unknown>
    if (role !== "user" && role !== "assistant") return null
    if (typeof content !== "string") return null
    clean.push({ role, content: content.slice(0, MAX_CHARS_PER_MESSAGE) })
  }
  return clean
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405)
  if (!isAuthorized(req)) return json({ code: "unauthorized" }, 401)

  const ip = clientIp(req)
  const allowance = allowanceFor(req, ip)
  if (!IS_LOCAL_DEV) {
    if (await overBurst(ip)) return json({ code: "rate_limited" }, 429)
    if ((await getSpend(allowance.key)) >= allowance.budget) return json({ code: "limit" }, 429)
  }

  const apiKey = Netlify.env.get("OPENROUTER_API_KEY")
  if (!apiKey) return json({ code: "unavailable" }, 503)

  let body: { messages?: unknown; river?: unknown; mode?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ code: "invalid_request" }, 400)
  }
  const messages = validateMessages(body.messages)
  if (!messages) return json({ code: "invalid_request" }, 400)
  const previous = sanitizeRiver(body.river, messages.length)
  const mode: Mode = body.mode === "reflect" ? "reflect" : "draw"
  // A draw with nothing new to read (a reply that failed, say), or a
  // reflection on a river that hasn't caught up or has too little in it: the
  // river stands.
  if (mode === "draw" && previous.upTo >= messages.length) return json({ river: previous }, 200)
  if (mode === "reflect" && (previous.upTo < messages.length || previous.moves.length < 4)) {
    return json({ river: previous }, 200)
  }

  let upstream: Response
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://delphi-web.netlify.app",
        "X-Title": "Delphi",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: mode === "draw" ? MAX_OUTPUT_TOKENS : REFLECT_OUTPUT_TOKENS,
        // Speed matters more than depth: a draw should land soon after
        // Delphi's reply does, and a reflection's hindsight comes from
        // reading the whole conversation, not from thinking longer.
        reasoning: { effort: "minimal" },
        usage: { include: true },
        response_format: {
          type: "json_schema",
          json_schema:
            mode === "draw"
              ? { name: "thought_river", strict: true, schema: SCHEMA }
              : { name: "river_reflection", strict: true, schema: REFLECT_SCHEMA },
        },
        messages: [
          { role: "system", content: prompt(mode) },
          { role: "user", content: mode === "draw" ? brief(messages, previous) : reflectBrief(messages, previous) },
        ],
      }),
      signal: req.signal,
    })
  } catch (err) {
    console.error("river upstream fetch failed:", err)
    return json({ code: "upstream_error" }, 502)
  }

  if (!upstream.ok) {
    console.error("river openrouter error:", upstream.status, await upstream.text().catch(() => ""))
    return json({ code: "upstream_error" }, 502)
  }

  let result: {
    choices?: { message?: { content?: string } }[]
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
  }
  try {
    result = await upstream.json()
  } catch (err) {
    // OpenRouter can send a 200 whose body breaks off or isn't JSON.
    console.error("river: unreadable upstream response:", err)
    return json({ river: previous, kept: true }, 200)
  }

  if (!IS_LOCAL_DEV) {
    const u = result.usage
    const cost =
      typeof u?.cost === "number"
        ? u.cost
        : ((u?.prompt_tokens ?? 0) * FALLBACK_PRICE_PER_MTOK.input +
            (u?.completion_tokens ?? 0) * FALLBACK_PRICE_PER_MTOK.output) /
          1_000_000
    await addSpend(allowance.key, cost)
  }

  // A malformed answer keeps the river as it was rather than breaking it.
  let answer: Record<string, unknown>
  try {
    answer = JSON.parse(result.choices?.[0]?.message?.content ?? "")
  } catch {
    console.error("river: unparseable model output")
    return json({ river: previous, kept: true }, 200)
  }
  if (mode === "reflect") return json({ river: applyReflection(previous, answer) }, 200)
  const moves = appendMoves(previous.moves, answer.moves, previous.upTo + 1, messages.length)
  // Past the budget, a new "realization" is drawn as the claim it otherwise is.
  let room = realizationBudget(messages.length) - realizationsIn(previous.moves)
  for (const m of moves.slice(previous.moves.length)) {
    if (m.kind !== "realization") continue
    if (room > 0) room--
    else m.kind = "claim"
  }
  const river: River = {
    ...previous,
    title: clip(answer.title, MAX_TITLE_CHARS) || previous.title,
    upTo: messages.length,
    moves,
  }
  return json({ river }, 200)
}
