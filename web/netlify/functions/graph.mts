import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
// The thought graph: a second, cheap model reads the conversation and returns
// a map of the user's thinking as JSON. It runs beside the chat and never
// touches it — chat.mts is unchanged. Spend is billed to the same allowance
// as the chat, so a graph can't be used to get around the budget.
// ─────────────────────────────────────────────────────────────────────────────

/** OpenRouter's moving alias for the newest Gemini Flash. */
const MODEL = "~google/gemini-flash-latest"

/** The graph is small JSON; this is a generous ceiling. */
const MAX_OUTPUT_TOKENS = 2000

/** Same allowances as chat.mts — keep in sync. */
const FREE_BUDGET_USD = Number(Netlify.env.get("FREE_BUDGET_USD") ?? "0.5")
const PAID_BUDGET_USD = Number(Netlify.env.get("PAID_BUDGET_USD") ?? "2")
const DAILY_IP_BUDGET_USD = Number(Netlify.env.get("DAILY_IP_BUDGET_USD") ?? "0.5")
const FALLBACK_PRICE_PER_MTOK = { input: 1, output: 4 }

/** Same input guards as chat.mts. */
const MAX_MESSAGES = 40
const MAX_CHARS_PER_MESSAGE = 8_000
const MAX_TOTAL_CHARS = 24_000

/** Its own burst window, so drawing the graph never eats into the chat's. */
const BURST_LIMIT = { windowSeconds: 60, max: 20 }

const ALLOWED_ORIGINS = ["https://delphi-web.netlify.app"]

/** Hard limits on what reaches the client, whatever the model returns. */
const MAX_NODES = 10
const MAX_EDGES = 18
const MAX_LABEL_CHARS = 32
const MAX_TITLE_CHARS = 48

/** Outermost ring first; the core sits at the centre. */
const LAYERS = ["surface", "reaction", "belief", "core"] as const
const EDGE_KINDS = ["link", "tension"] as const

// ─────────────────────────────────────────────────────────────────────────────
// Prompt: graph-prompt.md, bundled via netlify.toml `included_files`. Re-read
// on every request under `netlify dev`, so an edit applies to the next turn.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const IS_LOCAL_DEV = Netlify.env.get("NETLIFY_DEV") === "true"

const loadPrompt = (): string => {
  const candidates = [
    ...["", "..", "../..", "../../.."].map((up) => resolve(here, up, "graph-prompt.md")),
    // `netlify dev` started before graph-prompt.md was added to included_files
    // doesn't bundle it; read the source instead.
    resolve(process.cwd(), "web/graph-prompt.md"),
    resolve(process.cwd(), "graph-prompt.md"),
  ]
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf-8")
    } catch {
      // try next
    }
  }
  throw new Error("graph-prompt.md not found")
}

const PROMPT = loadPrompt()
const prompt = () => (IS_LOCAL_DEV ? loadPrompt() : PROMPT)

// ─────────────────────────────────────────────────────────────────────────────
// Types and the response schema the model is held to
// ─────────────────────────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string }
type EdgeKind = (typeof EDGE_KINDS)[number]
type Layer = (typeof LAYERS)[number]
type GraphNode = { id: string; label: string; layer: Layer }
type GraphEdge = { from: string; to: string; kind: EdgeKind }
type Graph = { title: string; frontier: string; nodes: GraphNode[]; edges: GraphEdge[] }

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "frontier", "nodes", "edges"],
  properties: {
    title: { type: "string" },
    frontier: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "layer"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          layer: { type: "string", enum: LAYERS },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "kind"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          kind: { type: "string", enum: EDGE_KINDS },
        },
      },
    },
  },
}

/**
 * Whatever came back — from the model, or from the client as the previous
 * graph — leaves here well-formed: known layers and kinds, unique ids, clamped
 * text, at most one core, no self-loops, no duplicate or dangling edges, and
 * within the size limits.
 */
const sanitize = (input: unknown): Graph => {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const clip = (s: unknown, n: number) =>
    typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : ""

  const nodes: GraphNode[] = []
  const ids = new Set<string>()
  let hasCore = false
  for (const n of (Array.isArray(raw.nodes) ? raw.nodes : []) as Record<string, any>[]) {
    if (nodes.length >= MAX_NODES) break
    const id = clip(n?.id, 24)
    const label = clip(n?.label, MAX_LABEL_CHARS)
    if (!id || !label || ids.has(id)) continue
    ids.add(id)
    let layer: Layer = LAYERS.includes(n.layer) ? n.layer : "surface"
    // The centre holds one thought; a second "core" stays one ring out.
    if (layer === "core" && hasCore) layer = "belief"
    if (layer === "core") hasCore = true
    nodes.push({ id, label, layer })
  }

  const edges: GraphEdge[] = []
  const pairs = new Set<string>()
  for (const e of (Array.isArray(raw.edges) ? raw.edges : []) as Record<string, any>[]) {
    if (edges.length >= MAX_EDGES) break
    const from = clip(e?.from, 24)
    const to = clip(e?.to, 24)
    const pair = [from, to].sort().join("|")
    if (!ids.has(from) || !ids.has(to) || from === to || pairs.has(pair)) continue
    pairs.add(pair)
    edges.push({ from, to, kind: e.kind === "tension" ? "tension" : "link" })
  }

  return {
    title: clip(raw.title, MAX_TITLE_CHARS),
    frontier: clip(raw.frontier, MAX_LABEL_CHARS),
    nodes,
    edges,
  }
}

/** The whole request as one message: the transcript, then the map so far. */
const brief = (messages: ChatMessage[], previous: Graph): string => {
  const transcript = messages
    // Delphi's replies can open with a <situation N> tag; it's for the chat
    // model, not part of what was said.
    .map((m) => `[${m.role === "user" ? "USER" : "DELPHI"}]\n${m.content.replace(/<situation[^>]*>/g, "").trim()}`)
    .join("\n\n")
  return [
    "<conversation>",
    transcript,
    "</conversation>",
    "",
    "<previous_map>",
    JSON.stringify(previous),
    "</previous_map>",
    "",
    "Return the updated map.",
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
    const key = `graph:${ip}:${bucket}`
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
  let total = 0
  const clean: ChatMessage[] = []
  for (const m of input) {
    const { role, content } = (m ?? {}) as Record<string, unknown>
    if (role !== "user" && role !== "assistant") return null
    if (typeof content !== "string" || content.length > MAX_CHARS_PER_MESSAGE) return null
    total += content.length
    clean.push({ role, content })
  }
  return total > MAX_TOTAL_CHARS ? null : clean
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

  let body: { messages?: unknown; graph?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ code: "invalid_request" }, 400)
  }
  const messages = validateMessages(body.messages)
  if (!messages) return json({ code: "invalid_request" }, 400)
  const previous = sanitize(body.graph)

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
        max_tokens: MAX_OUTPUT_TOKENS,
        // Speed matters more than depth: the graph should land while Delphi
        // is still replying.
        reasoning: { effort: "minimal" },
        usage: { include: true },
        response_format: {
          type: "json_schema",
          json_schema: { name: "thought_graph", strict: true, schema: SCHEMA },
        },
        messages: [
          { role: "system", content: prompt() },
          { role: "user", content: brief(messages, previous) },
        ],
      }),
      signal: req.signal,
    })
  } catch (err) {
    console.error("graph upstream fetch failed:", err)
    return json({ code: "upstream_error" }, 502)
  }

  if (!upstream.ok) {
    console.error("graph openrouter error:", upstream.status, await upstream.text().catch(() => ""))
    return json({ code: "upstream_error" }, 502)
  }

  const result = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
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

  // A malformed answer keeps the previous graph rather than breaking it.
  let graph: Graph
  try {
    graph = sanitize(JSON.parse(result.choices?.[0]?.message?.content ?? ""))
  } catch {
    console.error("graph: unparseable model output")
    return json({ graph: previous, kept: true }, 200)
  }
  return json({ graph }, 200)
}
