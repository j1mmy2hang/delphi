/**
 * The thought map: what the user has said, drawn as rings. The outer ring is
 * the surface (what happened); each ring inward goes a layer deeper, and the
 * centre holds the core once the user reaches it. Mirrors the shape returned
 * by netlify/functions/graph.mts.
 */

export const LAYERS = ['surface', 'reaction', 'belief', 'core'] as const
export type Layer = (typeof LAYERS)[number]

export interface MapNode {
  id: string
  label: string
  layer: Layer
  /** Whose thought: the user's own, or Delphi's reading of them. Older saved maps lack it. */
  by?: 'user' | 'delphi'
}

export interface MapEdge {
  from: string
  to: string
  kind: 'link' | 'tension'
}

export interface ThoughtGraph {
  title: string
  /** The open question the user is circling, or '' when there isn't one. */
  frontier: string
  nodes: MapNode[]
  edges: MapEdge[]
}

/** What the client keeps per conversation, beyond the graph itself. */
export interface ThoughtMapState {
  graph: ThoughtGraph
  /** A node's label before its latest revision, kept so the change shows. */
  was: Record<string, string>
  /** Where the conversation began: the first thought ever drawn. */
  origin: string
  /** Bumped on every change, so the header button can say "something new". */
  version: number
  /** Which arrangement around the rings; reshuffling picks another. */
  seed: number
}

export const EMPTY_GRAPH: ThoughtGraph = { title: '', frontier: '', nodes: [], edges: [] }

export const EMPTY_STATE: ThoughtMapState = { graph: EMPTY_GRAPH, was: {}, origin: '', version: 0, seed: 0 }
