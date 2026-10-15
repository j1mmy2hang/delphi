/**
 * Stand-in for the river function during `npm run dev`, so the river can be
 * seen without the API. It doesn't understand anything: each new message
 * becomes one move — the user's claims, Delphi's questions — resting on the
 * one before, and every sixth is a realization that pulls on an early move.
 * A reflection links the latest move back to the first, lets the user's first
 * position go, and says so. Set VITE_REAL_API=true for the real river.
 */
import type { Move, River } from '../river/types'

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

const gist = (text: string) => text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 10)

export const mockRiverFetch = async (
  request: { messages: { role: string; content: string }[]; river: River; mode?: 'reflect' },
  signal?: AbortSignal,
): Promise<Response> => {
  await sleep(request.mode === 'reflect' ? 3000 : 1400, signal)
  if (request.mode === 'reflect') return respond(reflect(request.river))
  const moves: Move[] = [...request.river.moves]
  request.messages.slice(request.river.upTo).forEach((m, i) => {
    const at = request.river.upTo + i + 1
    const last = moves.at(-1)
    const n = moves.length + 1
    const realization = n % 6 === 0 && moves.length > 3
    moves.push({
      id: `m${n}`,
      at,
      by: m.role === 'user' ? 'user' : 'delphi',
      kind: realization ? 'realization' : m.role === 'user' ? 'claim' : 'question',
      label: gist(m.content) || '…',
      rests: [
        ...(last ? [{ on: last.id, how: m.role === 'user' ? ('answers' as const) : ('builds' as const) }] : []),
        ...(realization ? [{ on: moves[1].id, how: 'builds' as const }] : []),
      ],
    })
  })
  return respond({ ...request.river, title: request.river.title || 'A conversation', upTo: request.messages.length, moves })
}

const respond = (river: River) =>
  new Response(JSON.stringify({ river }), { status: 200, headers: { 'Content-Type': 'application/json' } })

const reflect = (river: River): River => {
  const moves = river.moves.map((m) => ({ ...m, rests: [...m.rests] }))
  const first = moves.find((m) => m.by === 'user')
  const last = moves.filter((m) => m.by === 'user').at(-1)
  if (first && last && first !== last) {
    if (!last.rests.some((r) => r.on === first.id)) last.rests.push({ on: first.id, how: 'challenges' })
    last.kind = 'realization'
    first.revisedBy = last.id
  }
  return { ...river, moves, reflectedAt: river.upTo, insight: 'You started from one place and ended up somewhere else.' }
}
