import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../types'
import { mockRiverFetch } from '../dev/mockRiver'
import { EMPTY_STATE, type River, type ThoughtRiverState } from './types'

// Same switch as the chat: dev draws a fake river unless VITE_REAL_API=true.
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_REAL_API !== 'true'

// Bump the version when what a river means changes (its prompt or its shape):
// rivers saved under an older one are dropped and drawn again.
const STORAGE_PREFIX = 'delphi-river:v1:'

try {
  for (const key of Object.keys(localStorage)) {
    const stale = key.startsWith('delphi-map:') || (key.startsWith('delphi-river:') && !key.startsWith(STORAGE_PREFIX))
    if (stale) localStorage.removeItem(key)
  }
} catch {
  // Storage blocked: nothing saved to clear.
}

/**
 * Rivers live in this browser, one per conversation, beside (not inside) the
 * conversation's Markdown file. Losing one costs a single redraw.
 */
const read = (id: string): River | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? (JSON.parse(raw) as River) : null
  } catch {
    return null
  }
}

const write = (id: string, river: River) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(river))
  } catch {
    // Storage full or blocked: the river still works, it just won't be kept.
  }
}

/** What the river is drawn from: every message with something in it. */
const basisOf = (messages: Message[]) =>
  messages.filter((m) => m.content.trim()).map(({ role, content }) => ({ role, content }))

export type RiverStatus = 'idle' | 'drawing' | 'failed'

/**
 * The river grows once per exchange: when Delphi's reply has finished, it
 * reads the messages since it last looked — the user's and Delphi's both, as
 * half the river is where Delphi pushed — and appends their moves.
 */
export const useThoughtRiver = (messages: Message[], conversationId: string | null, streaming: boolean) => {
  const [state, setState] = useState<ThoughtRiverState>(EMPTY_STATE)
  const [status, setStatus] = useState<RiverStatus>('idle')
  const stateRef = useRef(state)
  stateRef.current = state

  const basis = useMemo(() => basisOf(messages), [messages])
  const basisRef = useRef(basis)
  basisRef.current = basis

  // A different conversation: show its saved river, or start empty.
  useEffect(() => {
    const saved = conversationId ? read(conversationId) : null
    const next = saved ? { river: saved, version: 0 } : EMPTY_STATE
    // Set the ref now: the drawing effect below runs in this same commit, and
    // must start from this conversation's river, not the last one's.
    stateRef.current = next
    setState(next)
    setStatus('idle')
  }, [conversationId])

  useEffect(() => {
    // While a reply streams in, wait for it; a send cancels any drawing still
    // under way, and the next one picks up both exchanges.
    if (streaming || !conversationId || basis.length <= stateRef.current.river.upTo) return
    const controller = new AbortController()
    const id = conversationId
    setStatus('drawing')

    const request = { messages: basisRef.current, river: stateRef.current.river }
    const response = USE_MOCK
      ? mockRiverFetch(request, controller.signal)
      : fetch('/.netlify/functions/river', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })

    response
      .then(async (res) => {
        if (!res.ok) throw new Error(`river ${res.status}`)
        const { river } = (await res.json()) as { river: River }
        const prev = stateRef.current
        const grew = river.moves.length > prev.river.moves.length
        const next = { river, version: prev.version + (grew ? 1 : 0) }
        write(id, river)
        stateRef.current = next
        setState(next)
        setStatus('idle')
      })
      .catch(() => {
        // The river is a companion to the chat, never a blocker: on failure it
        // keeps what it had, and the next exchange tries again.
        if (!controller.signal.aborted) setStatus('failed')
      })

    return () => controller.abort()
    // `basis.length` stands for the messages: it only grows when one is added.
  }, [conversationId, basis.length, streaming])

  return { ...state, status }
}
