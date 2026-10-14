/**
 * Stand-in for the graph function during `npm run dev`, so the map can be seen
 * without the API. It doesn't understand anything: each message becomes one
 * node a ring deeper than the last, linked to the one before, and the sixth
 * reaches the centre. Set VITE_REAL_API=true for the real map.
 */
import type { Layer, ThoughtGraph } from '../graph/types'

const DEPTH: Layer[] = ['surface', 'reaction', 'reaction', 'belief', 'belief', 'core']

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

export const mockGraphFetch = async (
  request: { messages: { role: string; content: string }[]; graph: ThoughtGraph },
  signal?: AbortSignal,
): Promise<Response> => {
  await sleep(1400, signal)
  const said = request.messages.filter((m) => m.role === 'user')
  const graph: ThoughtGraph = { title: '', frontier: '', nodes: [], edges: [] }
  said.forEach((m, i) => {
    const id = `n${i + 1}`
    graph.nodes.push({
      id,
      label: m.content.replace(/\s+/g, ' ').trim().slice(0, 10),
      layer: i === 5 ? 'core' : DEPTH[Math.min(i, 4)],
    })
    if (i > 0) graph.edges.push({ from: `n${i}`, to: id, kind: i % 3 === 2 ? 'tension' : 'link' })
  })
  graph.title = said[0]?.content.slice(0, 14) ?? ''
  graph.frontier = graph.nodes.some((n) => n.layer === 'core') ? '' : '底下还有什么？'
  return new Response(JSON.stringify({ graph }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
