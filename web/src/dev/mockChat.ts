/**
 * Stand-in for the chat function during `npm run dev`: "thinks" for a few
 * seconds, then streams a canned reply, in uneven bursts, in the same SSE shape the real endpoint
 * sends, so everything downstream runs unchanged. Set VITE_REAL_API=true in
 * .env.local to talk to the real function through `netlify dev` instead.
 */

const THINKING_MS = 3000

const REPLY = `That's worth slowing down for. A hard decision usually feels hard because two things you care about are pulling in different directions — not because you lack information.

A few questions that tend to cut through:

1. **What would you choose if nobody ever found out?** That strips away the part of the decision that's about how it looks.
2. **Which option are you arguing *against*?** The one you keep building a case against is often the one you want.
3. **What's the cost of waiting?** Sometimes "not yet" is a real answer, and sometimes it's just the most comfortable one.

Which of these feels closest to where you're stuck?`

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

/**
 * `/fail <code>` as a message makes the mock fail that way instead, so every
 * error notice can be seen without breaking anything:
 *   /fail network | interrupted | rate_limited | daily_limit | monthly_limit
 *   /fail message_too_long | conversation_too_long | unauthorized
 *   /fail unavailable | upstream_error
 */
const simulateFailure = (code: string): Response | 'network' | 'interrupted' => {
  if (code === 'network' || code === 'interrupted') return code
  const now = new Date()
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  switch (code) {
    case 'rate_limited':
      return json(429, { code, error: 'Too many requests.', retryAfter: 42 })
    case 'daily_limit':
      return json(429, {
        code,
        error: 'limit',
        resetAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000,
      })
    case 'monthly_limit':
      return json(429, {
        code,
        error: 'limit',
        resetAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) / 1000,
      })
    case 'message_too_long':
    case 'conversation_too_long':
      return json(400, { code, error: code })
    case 'unauthorized':
      return json(401, { code, error: 'Unauthorized' })
    case 'unavailable':
      return json(503, { code, error: 'Service unavailable' })
    default:
      return json(502, { code: 'upstream_error', error: 'Upstream error' })
  }
}

export const mockChatFetch = async (
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<Response> => {
  const fail = /^\/fail\s+(\S+)/.exec(history.at(-1)?.content ?? '')?.[1]
  const simulated = fail ? simulateFailure(fail) : null
  if (simulated === 'network') {
    await sleep(600, signal)
    throw new TypeError('Failed to fetch')
  }
  if (simulated instanceof Response) {
    await sleep(600, signal)
    return simulated
  }

  await sleep(simulated === 'interrupted' ? 800 : THINKING_MS, signal)
  const encoder = new TextEncoder()
  const words = REPLY.match(/\S+\s*/g) ?? []

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Real model output arrives in uneven bursts — a pause, three words,
        // a clump of a dozen — so the mock does too, or dev would hide how
        // the UI handles them.
        // An interrupted reply breaks off a third of the way in.
        const end = simulated === 'interrupted' ? Math.floor(words.length / 3) : words.length
        for (let i = 0; i < end; ) {
          const size = 1 + Math.floor(Math.random() * 12)
          const chunk = words.slice(i, i + size).join('')
          i += size
          const event = { choices: [{ delta: { content: chunk } }] }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          await sleep(20 + Math.random() * 230, signal)
        }
        if (simulated === 'interrupted') throw new Error('connection reset')
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}
