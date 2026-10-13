/**
 * Stand-in for the chat function during `npm run dev`: "thinks" for a few
 * seconds, then streams a canned reply in the same SSE shape the real endpoint
 * sends, so everything downstream runs unchanged. Set VITE_REAL_API=true in
 * .env.local to talk to the real function through `netlify dev` instead.
 */

const THINKING_MS = 3000
const TOKEN_MS = 24

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

export const mockChatFetch = async (signal?: AbortSignal): Promise<Response> => {
  await sleep(THINKING_MS, signal)
  const encoder = new TextEncoder()
  // Word-sized chunks, keeping the whitespace, read like a real stream.
  const tokens = REPLY.match(/\S+\s*/g) ?? []

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const token of tokens) {
          const event = { choices: [{ delta: { content: token } }] }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          await sleep(TOKEN_MS, signal)
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}
