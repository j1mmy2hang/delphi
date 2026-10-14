import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../types'
import { mockGraphFetch } from '../dev/mockGraph'
import { EMPTY_STATE, type ThoughtGraph, type ThoughtMapState } from './types'

// Same switch as the chat: dev draws a fake map unless VITE_REAL_API=true.
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_REAL_API !== 'true'

// Bump the version when what a map means changes (its prompt or its shape):
// maps saved under an older one are dropped and drawn again.
const STORAGE_PREFIX = 'delphi-map:v3:'

try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('delphi-map:') && !key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key)
  }
} catch {
  // Storage blocked: nothing saved to clear.
}

type Saved = ThoughtMapState & { drawnFor: string }

/**
 * Maps live in this browser, one per conversation, beside (not inside) the
 * conversation's Markdown file. Losing one costs a single redraw.
 */
const read = (id: string): Saved | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}

const write = (id: string, saved: Saved) => {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(saved))
  } catch {
    // Storage full or blocked: the map still works, it just won't be kept.
  }
}

/** Folds a new graph into the state: remembers revisions and where it began. */
const advance = (prev: ThoughtMapState, graph: ThoughtGraph): ThoughtMapState => {
  if (JSON.stringify(graph) === JSON.stringify(prev.graph)) return prev
  const before = new Map(prev.graph.nodes.map((n) => [n.id, n.label]))
  const was: Record<string, string> = {}
  for (const n of graph.nodes) {
    const old = before.get(n.id)
    if (old !== undefined && old !== n.label) was[n.id] = old
    else if (prev.was[n.id]) was[n.id] = prev.was[n.id]
  }
  const first = graph.nodes.find((n) => n.layer === 'surface') ?? graph.nodes[0]
  return {
    graph,
    was,
    origin: prev.origin || first?.label || '',
    version: prev.version + 1,
    seed: prev.seed,
  }
}

/**
 * The map is drawn from the user's side of the conversation: it updates the
 * moment a message is sent, in parallel with Delphi's reply, and never waits
 * for it. What it's drawn from: every message up to the user's latest.
 */
const basisOf = (messages: Message[]) => {
  let end = messages.length
  while (end > 0 && messages[end - 1].role !== 'user') end--
  return messages
    .slice(0, end)
    .filter((m) => m.content.trim())
    .map(({ role, content }) => ({ role, content }))
}

export type MapStatus = 'idle' | 'drawing' | 'failed'

export const useThoughtMap = (messages: Message[], conversationId: string | null) => {
  const [state, setState] = useState<ThoughtMapState>(EMPTY_STATE)
  const [status, setStatus] = useState<MapStatus>('idle')
  const stateRef = useRef(state)
  stateRef.current = state
  // Which basis the map on screen was drawn for, so a re-render, or reopening
  // a conversation whose map is already saved, doesn't draw it again.
  const drawnFor = useRef('')

  // `messages` changes on every streamed token of Delphi's reply; the basis
  // doesn't. Only the key drives the effect, so a reply streaming in never
  // cancels the drawing it runs beside.
  const basis = useMemo(() => basisOf(messages), [messages])
  const basisRef = useRef(basis)
  basisRef.current = basis
  const basisKey = useMemo(() => {
    const last = basis.at(-1)
    return last ? `${basis.length}:${last.content.length}:${last.content.slice(-32)}` : ''
  }, [basis])

  // A different conversation: show its saved map, or start empty.
  useEffect(() => {
    const saved = conversationId ? read(conversationId) : null
    drawnFor.current = saved?.drawnFor ?? ''
    const next = saved
      ? { graph: saved.graph, was: saved.was, origin: saved.origin, version: 0, seed: saved.seed ?? 0 }
      : EMPTY_STATE
    // Set the ref now: the drawing effect below runs in this same commit, and
    // must start from this conversation's map, not the last one's.
    stateRef.current = next
    setState(next)
    setStatus('idle')
  }, [conversationId])

  useEffect(() => {
    if (!conversationId || !basisKey || basisKey === drawnFor.current) return
    const controller = new AbortController()
    const id = conversationId
    setStatus('drawing')

    const request = { messages: basisRef.current, graph: stateRef.current.graph }
    const response = USE_MOCK
      ? mockGraphFetch(request, controller.signal)
      : fetch('/.netlify/functions/graph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })

    response
      .then(async (res) => {
        if (!res.ok) throw new Error(`graph ${res.status}`)
        const { graph } = (await res.json()) as { graph: ThoughtGraph }
        const next = advance(stateRef.current, graph)
        drawnFor.current = basisKey
        write(id, { ...next, drawnFor: basisKey })
        setState(next)
        setStatus('idle')
      })
      .catch(() => {
        // The map is a companion to the chat, never a blocker: on failure it
        // keeps what it had, and the next message tries again.
        if (!controller.signal.aborted) setStatus('failed')
      })

    return () => controller.abort()
  }, [conversationId, basisKey])

  /**
   * Another arrangement of the same map: every thought keeps its ring, only
   * where it sits around it changes. Kept with the map, and not news, so the
   * header button doesn't light up for it.
   */
  const reshuffle = useCallback(() => {
    const next = { ...stateRef.current, seed: Math.floor(Math.random() * 2 ** 31) }
    stateRef.current = next
    setState(next)
    if (conversationId) write(conversationId, { ...next, drawnFor: drawnFor.current })
  }, [conversationId])

  return { ...state, status, reshuffle }
}
