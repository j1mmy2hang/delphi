import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../types'
import { mockRiverFetch } from '../dev/mockRiver'
import { EMPTY_RIVER, EMPTY_STATE, type River, type ThoughtRiverState } from './types'

// Same switch as the chat: dev draws a fake river unless VITE_REAL_API=true.
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_REAL_API !== 'true'

// Bump the version when what a river means changes (its prompt or its shape):
// rivers saved under an older one are dropped and drawn again.
const STORAGE_PREFIX = 'delphi-river:v3:'

try {
  for (const key of Object.keys(localStorage)) {
    const stale = key.startsWith('delphi-map:') || (key.startsWith('delphi-river:') && !key.startsWith(STORAGE_PREFIX))
    if (stale) localStorage.removeItem(key)
  }
} catch {
  // Storage blocked: nothing saved to clear.
}

/** A saved river, if it is one. */
const asRiver = (raw: unknown): River | null => {
  const r = raw as Partial<River> | null
  return r && typeof r === 'object' && Array.isArray(r.moves) && typeof r.upTo === 'number'
    ? { ...EMPTY_RIVER, ...r }
    : null
}

/**
 * Rivers are kept twice: in the conversations folder beside the Markdown files
 * (see RiverStore), which is the copy that lasts, and in this browser, which
 * is there at once and covers browsers with no folder.
 */
const read = (id: string): River | null => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? asRiver(JSON.parse(raw)) : null
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

export type RiverStatus = 'idle' | 'drawing' | 'reflecting' | 'failed'

/** Where rivers last: the conversations folder, when there is one. */
export interface RiverStore {
  load: (id: string) => Promise<unknown>
  save: (id: string, river: River) => void
}

type Basis = ReturnType<typeof basisOf>

/**
 * Delphi stepping back to sum up (situations 3 and 4, and the `<end>` that
 * closes a conversation): a moment for hindsight. A closed conversation's last
 * reflection gives its river its final gist.
 */
const STEP_BACK = /<situation\s*[34]\s*>|<\s*end\s*\/?>/i
/** Otherwise, a reflection every this many of the user's turns. */
const TURNS_PER_REFLECTION = 4
/** Too few moves and there's nothing to see in hindsight yet. */
const MIN_MOVES = 6

const reflectionDue = (river: River, basis: Basis) => {
  if (river.moves.length < MIN_MOVES || river.upTo !== basis.length || river.reflectedAt >= river.upTo) return false
  const since = basis.slice(river.reflectedAt)
  return (
    since.some((m) => m.role === 'assistant' && STEP_BACK.test(m.content)) ||
    since.filter((m) => m.role === 'user').length >= TURNS_PER_REFLECTION
  )
}

const callRiver = (request: { messages: Basis; river: River; mode?: 'reflect' }, signal: AbortSignal) =>
  USE_MOCK
    ? mockRiverFetch(request, signal)
    : fetch('/.netlify/functions/river', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      })

/**
 * The river grows once per exchange: when Delphi's reply has finished, it
 * reads the messages since it last looked — the user's and Delphi's both, as
 * half the river is where Delphi pushed — and appends their moves. Every few
 * exchanges, or when Delphi steps back to sum up, it then reflects: reads the
 * whole conversation again with hindsight and refines the river. Drawing
 * waits for a reflection to finish, so the two never edit at once.
 */
export const useThoughtRiver = (
  messages: Message[],
  conversationId: string | null,
  streaming: boolean,
  store: RiverStore | null,
) => {
  const [state, setState] = useState<ThoughtRiverState>(EMPTY_STATE)
  const [status, setStatus] = useState<RiverStatus>('idle')
  const stateRef = useRef(state)
  stateRef.current = state
  const storeRef = useRef(store)
  storeRef.current = store
  // The conversation whose saved river has been looked for; drawing waits for
  // it, so a river in the folder is never drawn again from scratch.
  const [ready, setReady] = useState<string | null>(null)
  // Bumped to try again after a failure.
  const [attempt, setAttempt] = useState(0)

  const basis = useMemo(() => basisOf(messages), [messages])
  const basisRef = useRef(basis)
  basisRef.current = basis

  // A reflection in flight. Unlike a draw, a new message doesn't cancel it
  // (it'd rarely finish); only leaving the conversation does.
  const reflecting = useRef<AbortController | null>(null)
  // Bumped when a reflection ends, so drawing picks up what arrived meanwhile.
  const [reflections, setReflections] = useState(0)

  const commit = (id: string, river: River, changed: boolean) => {
    const prev = stateRef.current
    const next = { river, version: prev.version + (changed ? 1 : 0) }
    write(id, river)
    storeRef.current?.save(id, river)
    stateRef.current = next
    setState(next)
  }

  // Where a reflection was last tried, so a failed one isn't retried in a loop;
  // the next exchange gives it another chance.
  const triedAt = useRef(-1)

  const reflect = (id: string, river: River) => {
    if (triedAt.current === river.upTo) return
    triedAt.current = river.upTo
    const controller = new AbortController()
    reflecting.current = controller
    setStatus('reflecting')
    callRiver({ messages: basisRef.current.slice(0, river.upTo), river, mode: 'reflect' }, controller.signal)
      .then(async (res) => {
        if (!res.ok) throw new Error(`river ${res.status}`)
        const { river: reflected } = (await res.json()) as { river: River }
        // Only onto the river it reflected on: nothing else edits it meanwhile.
        if (controller.signal.aborted || stateRef.current.river !== river) return
        commit(id, { ...EMPTY_RIVER, ...reflected }, true)
        setStatus('idle')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('failed')
      })
      .finally(() => {
        if (reflecting.current === controller) reflecting.current = null
        setReflections((n) => n + 1)
      })
  }

  // A different conversation: show its saved river, or start empty. The
  // browser's copy shows at once; the folder's replaces it if it's further on.
  useEffect(() => {
    const id = conversationId
    const saved = id ? read(id) : null
    const next = saved ? { river: saved, version: 0 } : EMPTY_STATE
    // Set the ref now: the drawing effect below runs in this same commit, and
    // must start from this conversation's river, not the last one's.
    stateRef.current = next
    setState(next)
    setStatus('idle')
    triedAt.current = -1
    let cancelled = false
    const folder = storeRef.current
    if (!id || !folder) setReady(id)
    else {
      setReady(null)
      folder
        .load(id)
        .then((raw) => {
          if (cancelled) return
          const kept = asRiver(raw)
          const current = stateRef.current.river
          if (kept && kept.upTo >= current.upTo) {
            write(id, kept)
            const loaded = { river: kept, version: 0 }
            stateRef.current = loaded
            setState(loaded)
          }
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setReady(id))
    }
    return () => {
      cancelled = true
      reflecting.current?.abort()
      reflecting.current = null
    }
  }, [conversationId])

  /**
   * Throws this conversation's river away, here and in the folder, and draws
   * it again from the whole conversation (a reflection follows, as ever).
   */
  const redraw = () => {
    const id = conversationId
    if (!id) return
    reflecting.current?.abort()
    reflecting.current = null
    triedAt.current = -1
    write(id, EMPTY_RIVER)
    storeRef.current?.save(id, EMPTY_RIVER)
    const cleared = { river: EMPTY_RIVER, version: stateRef.current.version }
    stateRef.current = cleared
    setState(cleared)
    setStatus('idle')
    // Re-runs the drawing effect, which also cancels a draw still under way.
    setAttempt((n) => n + 1)
  }

  /** Tries again after a failed draw or reflection. */
  const retry = () => {
    triedAt.current = -1
    setStatus('idle')
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    // While a reply streams in, wait for it; a send cancels any drawing still
    // under way, and the next one picks up both exchanges.
    if (streaming || !conversationId || ready !== conversationId || reflecting.current) return
    const id = conversationId
    // Caught up, but owed a reflection (one cut short when the page closed, say).
    if (basis.length <= stateRef.current.river.upTo) {
      if (reflectionDue(stateRef.current.river, basisRef.current)) reflect(id, stateRef.current.river)
      return
    }
    const controller = new AbortController()
    setStatus('drawing')

    callRiver({ messages: basisRef.current, river: stateRef.current.river }, controller.signal)
      .then(async (res) => {
        if (!res.ok) throw new Error(`river ${res.status}`)
        const { river: drawn } = (await res.json()) as { river: River }
        // Left this conversation meanwhile: its river isn't this one's.
        if (controller.signal.aborted) return
        const river = { ...EMPTY_RIVER, ...drawn }
        // The server keeps the river as it was when the model's answer was
        // unusable; that's a failure to show, not a river to keep.
        if (river.upTo < basisRef.current.length && river.upTo <= stateRef.current.river.upTo) {
          setStatus('failed')
          return
        }
        commit(id, river, river.moves.length > stateRef.current.river.moves.length)
        setStatus('idle')
        if (reflectionDue(river, basisRef.current)) reflect(id, river)
      })
      .catch(() => {
        // The river is a companion to the chat, never a blocker: on failure it
        // keeps what it had, and the next exchange tries again.
        if (!controller.signal.aborted) setStatus('failed')
      })

    return () => controller.abort()
    // `basis.length` stands for the messages: it only grows when one is added.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, basis.length, streaming, reflections, ready, attempt])

  return { ...state, status, retry, redraw }
}
