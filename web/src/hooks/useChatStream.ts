import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import { mockChatFetch } from '../dev/mockChat'
import { describe, failureFromResponse, FailureError, type Failure } from '../chat/failures'

// Dev talks to a fake backend unless VITE_REAL_API=true; production builds
// always use the real one (and drop the mock as dead code).
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_REAL_API !== 'true'

interface UseChatStream {
  messages: Message[]
  isStreaming: boolean
  send: (text: string) => void
  /** Sends the last question again, replacing the reply that failed. */
  retry: () => void
  stop: () => void
  reset: () => void
  load: (messages: Message[]) => void
}

/**
 * What the model is shown: real text only. A failed reply's notice is UI, not
 * something Delphi said, and an empty reply is nothing at all.
 */
const historyOf = (messages: Message[]) =>
  messages
    .filter((m) => m.content.trim())
    .map(({ role, content }) => ({ role, content }))

export const useChatStream = (): UseChatStream => {
  const [messages, setMessagesState] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // The latest list, readable outside a state update. Requests start from
  // event handlers rather than inside setState updaters: React may run an
  // updater twice in development, which would send every request twice.
  const messagesRef = useRef<Message[]>([])

  const setMessages = useCallback((update: Message[] | ((prev: Message[]) => Message[])) => {
    const next = typeof update === 'function' ? update(messagesRef.current) : update
    messagesRef.current = next
    setMessagesState(next)
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setIsStreaming(false)
  }, [setMessages])

  // Keeps whatever has streamed so far. An assistant turn that never received
  // a token is dropped rather than left as an empty reply.
  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsStreaming(false)
    setMessages((prev) => {
      const last = prev.at(-1)
      return last?.role === 'assistant' && !last.content && !last.error ? prev.slice(0, -1) : prev
    })
  }, [setMessages])

  // Replaces the conversation with a saved one, abandoning any reply in flight.
  const load = useCallback(
    (saved: Message[]) => {
      abortRef.current?.abort()
      abortRef.current = null
      setIsStreaming(false)
      setMessages(saved)
    },
    [setMessages],
  )

  const begin = useCallback(
    (base: Message[]) => {
      setMessages([...base, { role: 'assistant', content: '' }])
      void runStream(historyOf(base), setMessages, setIsStreaming, abortRef)
    },
    [setMessages],
  )

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      begin([...messagesRef.current, { role: 'user', content: trimmed }])
    },
    [begin],
  )

  const retry = useCallback(() => {
    const current = messagesRef.current
    if (!current.at(-1)?.error) return
    // The failed reply goes, partial text and all; the question is asked again.
    begin(current.slice(0, -1))
  }, [begin])

  return { messages, isStreaming, send, retry, stop, reset, load }
}

const runStream = async (
  history: Pick<Message, 'role' | 'content'>[],
  setMessages: (update: (prev: Message[]) => Message[]) => void,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  abortRef: React.MutableRefObject<AbortController | null>,
) => {
  abortRef.current?.abort()
  const controller = new AbortController()
  abortRef.current = controller

  setIsStreaming(true)
  let accumulated = ''
  // Once the server has answered 200, a later failure means the stream broke
  // mid-reply rather than that the request never got through.
  let connected = false

  const setReply = (reply: Message) =>
    setMessages((prev) => [...prev.slice(0, -1), reply])

  try {
    const response = USE_MOCK
      ? await mockChatFetch(history, controller.signal)
      : await fetch('/.netlify/functions/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        })

    if (!response.ok || !response.body) throw new FailureError(await failureFromResponse(response))
    connected = true

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // Only consume up to the last newline; keep the partial tail for next chunk.
      const lastNewline = buffer.lastIndexOf('\n')
      if (lastNewline === -1) continue
      const consumable = buffer.slice(0, lastNewline)
      buffer = buffer.slice(lastNewline + 1)

      for (const line of consumable.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') {
          finished = true
          continue
        }
        let parsed: {
          error?: unknown
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[]
        }
        try {
          parsed = JSON.parse(data)
        } catch {
          continue // partial / non-JSON keepalive
        }
        // OpenRouter reports a failure after the 200 as an event in the stream.
        if (parsed.error || parsed.choices?.[0]?.finish_reason === 'error') {
          throw new FailureError(describe('interrupted'))
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          accumulated += delta
          setReply({ role: 'assistant', content: accumulated })
        }
      }
    }

    // The connection closed without the end-of-stream marker.
    if (!finished) throw new FailureError(describe('interrupted'))
  } catch (err) {
    if (controller.signal.aborted) return
    const failure: Failure =
      err instanceof FailureError ? err.failure : describe(connected ? 'interrupted' : 'network')
    // Whatever arrived before the failure stays on screen above the notice.
    setReply({ role: 'assistant', content: accumulated, error: failure })
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
      setIsStreaming(false)
    }
  }
}
