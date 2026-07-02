import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '../types'

interface UseChatStream {
  messages: Message[]
  isStreaming: boolean
  send: (text: string) => void
  reset: () => void
}

export const useChatStream = (): UseChatStream => {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setIsStreaming(false)
  }, [])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    setMessages(prev => {
      const next: Message[] = [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: '' },
      ]
      void runStream(next.slice(0, -1), setMessages, setIsStreaming, abortRef)
      return next
    })
  }, [])

  return { messages, isStreaming, send, reset }
}

const runStream = async (
  history: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  abortRef: React.MutableRefObject<AbortController | null>,
) => {
  abortRef.current?.abort()
  const controller = new AbortController()
  abortRef.current = controller

  setIsStreaming(true)
  let accumulated = ''

  try {
    let response: Response
    try {
      response = await fetch('/.netlify/functions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      })
    } catch (err) {
      // No backend (plain `vite dev`): let the design be experienced offline.
      if (import.meta.env.DEV) return void (await simulateStream(setMessages, controller))
      throw err
    }

    if (!response.ok || !response.body) {
      if (import.meta.env.DEV) return void (await simulateStream(setMessages, controller))
      throw new Error('Request failed')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            accumulated += delta
            const snapshot = accumulated
            setMessages(prev => {
              const next = [...prev]
              next[next.length - 1] = { role: 'assistant', content: snapshot }
              return next
            })
          }
        } catch {
          // partial / non-JSON keepalive
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = {
        role: 'assistant',
        content: '抱歉，出了点问题。请重新开始对话。',
      }
      return next
    })
  } finally {
    if (abortRef.current === controller) {
      abortRef.current = null
      setIsStreaming(false)
    }
  }
}

// Dev-only: a canned oracle reply, streamed word by word, so the wave can be
// experienced without the Netlify function running.
const simulateStream = async (
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  controller: AbortController,
) => {
  const reply =
    'The clearest thinking rarely arrives as a single answer. It surfaces as a better question — ' +
    'one that quietly reframes what you were certain you already knew. Sit with the tension a moment longer ' +
    'than feels comfortable, and notice what it is protecting.'
  const words = reply.split(' ')
  let acc = ''
  for (const word of words) {
    if (controller.signal.aborted) return
    acc += (acc ? ' ' : '') + word
    const snapshot = acc
    setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = { role: 'assistant', content: snapshot }
      return next
    })
    await new Promise(r => setTimeout(r, 38))
  }
}
