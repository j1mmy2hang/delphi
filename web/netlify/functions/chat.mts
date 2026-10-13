import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
// Tunables — everything you'd want to adjust lives here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The OpenRouter model. Cheaper models here = lower cost per message. The "~"
 * prefix is OpenRouter's moving alias: it always resolves to the newest Claude
 * Sonnet, so upgrades arrive without a code change.
 */
const MODEL = "~anthropic/claude-sonnet-latest"

/** Hard cap on tokens the model may generate per reply. Bounds cost per call. */
const MAX_OUTPUT_TOKENS = 1200

/**
 * Budget per user (device) per calendar month, in USD, by tier. When a device
 * has spent its tier's budget, requests are refused until the month rolls over.
 * Both are env-overridable so you can tune pricing without editing code.
 *   • free  — anyone. Kept small; subsidized by you.
 *   • paid  — unlocked by the $1.99/mo subscription (StoreKit).
 * NOTE: a paid user who spends the full paid budget nets you a small loss after
 * Apple's cut — tune PAID_BUDGET_USD / the price accordingly.
 */
const FREE_BUDGET_USD = Number(Netlify.env.get("FREE_BUDGET_USD") ?? "0.5")
const PAID_BUDGET_USD = Number(Netlify.env.get("PAID_BUDGET_USD") ?? "2")

/**
 * Which budget applies. The app sends `X-Tier: paid` only when StoreKit reports
 * an active, Apple-verified subscription. Faking it is bounded by the hard paid
 * cap (worst case a freeloader gets the paid budget instead of the free one),
 * so for an indie app this is an acceptable trade vs. full server-side receipt
 * verification. HARDENING HOOK: verify a subscription JWS here if abuse appears.
 */
/**
 * The public (web) allowance: per IP, per UTC day. The web app sends no device
 * id, so the IP is the only handle on a visitor; a daily window lets a real
 * person come back tomorrow instead of being locked out for the month. The
 * native app identifies itself with X-Device-Id and keeps the monthly,
 * per-device tiers above.
 */
const DAILY_IP_BUDGET_USD = Number(Netlify.env.get("DAILY_IP_BUDGET_USD") ?? "0.5")

const budgetFor = (req: Request): number =>
  req.headers.get("x-tier") === "paid" ? PAID_BUDGET_USD : FREE_BUDGET_USD

/**
 * Fallback pricing (USD per 1M tokens) used ONLY if OpenRouter doesn't return a
 * cost for a request. Keep roughly in line with the chosen model so metering
 * never silently reads $0. These are ceilings, not exact.
 */
const FALLBACK_PRICE_PER_MTOK = { input: 2, output: 10 }

/** Input guards — reject abusive / runaway conversations before they cost money. */
const MAX_MESSAGES = 40 // turns in a single request
const MAX_CHARS_PER_MESSAGE = 8_000 // ~2k tokens
const MAX_TOTAL_CHARS = 24_000 // whole conversation

/**
 * Per-IP burst limit (anti-abuse). The real spend ceiling is the monthly budget
 * above; this just stops someone hammering the endpoint. Fixed window.
 */
const BURST_LIMIT = { windowSeconds: 60, max: 15 }

/**
 * Origins allowed to call this without a token (your web app). Add custom
 * domains here. Native apps use the token instead (see APP_SHARED_TOKEN below).
 */
const ALLOWED_ORIGINS = [
  "https://delphi-web.netlify.app",
  // "https://your-custom-domain.com",
]

// ─────────────────────────────────────────────────────────────────────────────
// System prompt (unchanged): bundled via netlify.toml `included_files`.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))

const loadSystemPrompt = (): string => {
  const candidates = [
    resolve(here, "system-prompt.md"),
    resolve(here, "../system-prompt.md"),
    resolve(here, "../../system-prompt.md"),
    resolve(here, "../../../system-prompt.md"),
  ]
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf-8")
    } catch {
      // try next
    }
  }
  throw new Error("system-prompt.md not found")
}

const SYSTEM_PROMPT = loadSystemPrompt()

/** Set by `netlify dev` (and only there), so this is false on the live site. */
const IS_LOCAL_DEV = Netlify.env.get("NETLIFY_DEV") === "true"

let lastDevPrompt = SYSTEM_PROMPT

/**
 * Deployed, the prompt is read once per function instance. Locally it's re-read
 * on every request, so an edit to system-prompt.md applies to the next message
 * sent — no restart. The function file itself isn't touched by that edit, so
 * `netlify dev` wouldn't otherwise reload it.
 */
const systemPrompt = (): string => {
  if (!IS_LOCAL_DEV) return SYSTEM_PROMPT
  const current = loadSystemPrompt()
  if (current !== lastDevPrompt) {
    console.log("[dev] system-prompt.md changed — using the new version")
    lastDevPrompt = current
  }
  return current
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

type ChatMessage = { role: "user" | "assistant"; content: string }

const jsonResponse = (body: unknown, status: number, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  })

/**
 * Every error carries a stable `code` for clients to branch on, beside a
 * readable `error` message. Clients show their own wording per code; `error`
 * is for logs and curl.
 */
type ErrorCode =
  | "method_not_allowed"
  | "unauthorized"
  | "rate_limited"
  | "daily_limit"
  | "monthly_limit"
  | "unavailable"
  | "invalid_request"
  | "message_too_long"
  | "conversation_too_long"
  | "upstream_error"

const jsonError = (
  code: ErrorCode,
  message: string,
  status: number,
  extra?: { body?: Record<string, unknown>; headers?: Record<string, string> },
) => jsonResponse({ error: message, code, ...extra?.body }, status, extra?.headers)

/** Constant-time string compare so the token check can't be timed. */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const clientIp = (req: Request): string =>
  req.headers.get("x-nf-client-connection-ip") ??
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown"

/** Current UTC month bucket, e.g. "2026-07". */
const monthKey = (): string => {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Epoch seconds at which the monthly budget resets (first of next UTC month). */
const nextResetEpoch = (): number => {
  const d = new Date()
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000)
}

/** Current UTC day bucket, e.g. "2026-10-13". */
const dayKey = (): string => new Date().toISOString().slice(0, 10)

/** Epoch seconds at which the daily allowance resets (next UTC midnight). */
const nextDayResetEpoch = (): number => {
  const d = new Date()
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000)
}

/**
 * Authorized if either the native app presents the shared token, or the request
 * comes from an allowed web origin. If APP_SHARED_TOKEN is unset, auth is OFF
 * (open) so deploying never breaks the live site.
 */
const isAuthorized = (req: Request): boolean => {
  const expected = Netlify.env.get("APP_SHARED_TOKEN")
  if (!expected) return true // gate disabled

  const token = req.headers.get("x-app-token")
  if (token && safeEqual(token, expected)) return true

  const source = req.headers.get("origin") ?? req.headers.get("referer") ?? ""
  return ALLOWED_ORIGINS.some((o) => source.startsWith(o))
}

/** Validate & normalize the client payload. Rejects anything oversized or malformed. */
const validateMessages = (
  input: unknown,
): { ok: true; messages: ChatMessage[] } | { ok: false; code: ErrorCode; error: string } => {
  if (!Array.isArray(input)) return { ok: false, code: "invalid_request", error: "`messages` must be an array" }
  if (input.length === 0) return { ok: false, code: "invalid_request", error: "`messages` is empty" }
  if (input.length > MAX_MESSAGES) return { ok: false, code: "conversation_too_long", error: "too many messages" }

  let total = 0
  const clean: ChatMessage[] = []
  for (const m of input) {
    if (typeof m !== "object" || m === null) return { ok: false, code: "invalid_request", error: "malformed message" }
    const { role, content } = m as Record<string, unknown>
    // Only user/assistant allowed — the client can never inject a `system` role
    // and hijack the prompt.
    if (role !== "user" && role !== "assistant") return { ok: false, code: "invalid_request", error: "invalid role" }
    if (typeof content !== "string") return { ok: false, code: "invalid_request", error: "invalid content" }
    if (content.length > MAX_CHARS_PER_MESSAGE) return { ok: false, code: "message_too_long", error: "a message is too long" }
    total += content.length
    clean.push({ role, content })
  }
  if (total > MAX_TOTAL_CHARS) return { ok: false, code: "conversation_too_long", error: "conversation too long" }
  return { ok: true, messages: clean }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting + spend metering (Netlify Blobs — built in, no extra service).
// Both fail OPEN: a store hiccup serves the request rather than breaking the app.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-IP fixed-window burst limit. */
const checkBurst = async (ip: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> => {
  try {
    const store = getStore("ratelimit")
    const now = Math.floor(Date.now() / 1000)
    const bucket = Math.floor(now / BURST_LIMIT.windowSeconds)
    const key = `${ip}:${BURST_LIMIT.windowSeconds}:${bucket}`
    const current = (await store.get(key, { type: "json" })) as { count: number } | null
    const count = (current?.count ?? 0) + 1
    if (count > BURST_LIMIT.max) {
      return { ok: false, retryAfter: (bucket + 1) * BURST_LIMIT.windowSeconds - now }
    }
    await store.setJSON(key, { count })
    return { ok: true }
  } catch (err) {
    console.error("burst check failed, allowing request:", err)
    return { ok: true }
  }
}

/**
 * Which allowance a request draws on: the native app's monthly budget per
 * device, or the web's daily budget per IP. `key` names its spend record.
 */
type Allowance = { kind: "monthly" | "daily"; key: string; budget: number; resetAt: number }

const allowanceFor = (req: Request, ip: string): Allowance => {
  const device = req.headers.get("x-device-id")?.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64)
  if (device) {
    return { kind: "monthly", key: `${device}:${monthKey()}`, budget: budgetFor(req), resetAt: nextResetEpoch() }
  }
  return { kind: "daily", key: `web:${ip}:${dayKey()}`, budget: DAILY_IP_BUDGET_USD, resetAt: nextDayResetEpoch() }
}

const getSpend = async (key: string): Promise<number> => {
  try {
    const v = (await getStore("spend").get(key, { type: "json" })) as
      | { usd: number }
      | null
    return v?.usd ?? 0
  } catch (err) {
    console.error("getSpend failed, treating as 0:", err)
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

/** Pull the USD cost out of OpenRouter's final usage chunk (usage accounting on). */
const extractCost = (sseTail: string): number | null => {
  const lines = sseTail.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith("data:")) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === "[DONE]") continue
    try {
      const obj = JSON.parse(payload) as {
        usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
      }
      if (obj.usage) {
        if (typeof obj.usage.cost === "number") return obj.usage.cost
        const pt = obj.usage.prompt_tokens ?? 0
        const ct = obj.usage.completion_tokens ?? 0
        if (pt || ct) {
          return (
            (pt * FALLBACK_PRICE_PER_MTOK.input + ct * FALLBACK_PRICE_PER_MTOK.output) / 1_000_000
          )
        }
      }
    } catch {
      // not the usage line
    }
  }
  return null
}

/**
 * Pass the upstream stream straight through to the client while sniffing the
 * tail for the usage chunk, then bill the allowance once the stream completes.
 * A null key (local dev) streams without billing.
 */
const meteredPassthrough = (
  upstreamBody: ReadableStream<Uint8Array>,
  spendKey: string | null,
): ReadableStream<Uint8Array> => {
  const decoder = new TextDecoder()
  let buffer = ""
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      if (buffer.length > 16_384) buffer = buffer.slice(-16_384) // usage is at the end
      controller.enqueue(chunk)
    },
    async flush() {
      if (!spendKey) return
      const cost = extractCost(buffer)
      await addSpend(spendKey, cost ?? 0)
    },
  })
  return upstreamBody.pipeThrough(transform)
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return jsonError("method_not_allowed", "Method not allowed", 405)

  if (!isAuthorized(req)) return jsonError("unauthorized", "Unauthorized", 401)

  const ip = clientIp(req)
  const allowance = allowanceFor(req, ip)

  // Local `netlify dev` runs unmetered: no burst limit, no allowance, nothing
  // recorded — testing shouldn't spend down a budget or trip the throttle.
  if (!IS_LOCAL_DEV) {
    // Anti-abuse burst limit.
    const burst = await checkBurst(ip)
    if (!burst.ok) {
      return jsonError("rate_limited", "Too many requests. Please slow down.", 429, {
        body: { retryAfter: burst.retryAfter },
        headers: { "Retry-After": String(burst.retryAfter) },
      })
    }

    // The allowance for this caller. `error: "limit"` and `resetAt` are what
    // the iOS app reads to show its "you've hit your limit, it resets on …"
    // window; `code` tells the web which window it was.
    const spent = await getSpend(allowance.key)
    if (spent >= allowance.budget) {
      return jsonResponse(
        { error: "limit", code: `${allowance.kind}_limit`, resetAt: allowance.resetAt },
        429,
        { "X-Limit": allowance.kind },
      )
    }
  }

  const apiKey = Netlify.env.get("OPENROUTER_API_KEY")
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not configured")
    return jsonError("unavailable", "Service unavailable", 503)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("invalid_request", "Invalid JSON", 400)
  }

  const validated = validateMessages((body as { messages?: unknown })?.messages)
  if (!validated.ok) return jsonError(validated.code, validated.error, 400)

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
        stream: true,
        max_tokens: MAX_OUTPUT_TOKENS,
        usage: { include: true }, // ask OpenRouter to report cost in the stream
        messages: [
          {
            role: "system",
            // Prompt caching: the system prompt is the same for every user, so
            // Anthropic keeps it cached (5 minutes, refreshed on each hit) and
            // bills re-reads at 10% of the input price. A write costs 1.25×,
            // so only the first request after a quiet spell pays a little more.
            // The usage cost OpenRouter reports already reflects this.
            content: [
              { type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } },
            ],
          },
          ...validated.messages,
        ],
      }),
      signal: req.signal,
    })
  } catch (err) {
    console.error("upstream fetch failed:", err)
    return jsonError("upstream_error", "Upstream error", 502)
  }

  if (!upstream.ok || !upstream.body) {
    // Log the real reason; never leak upstream error bodies to the client.
    console.error("openrouter error:", upstream.status, await upstream.text().catch(() => ""))
    return jsonError("upstream_error", "The model provider returned an error.", 502)
  }

  return new Response(meteredPassthrough(upstream.body, IS_LOCAL_DEV ? null : allowance.key), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
