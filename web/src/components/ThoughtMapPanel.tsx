import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, Maximize2, Minimize2, Shuffle, X } from 'lucide-react'
import { EASE_IN, EASE_OUT } from '../constants'
import { saveMapCard } from '../graph/exportImage'
import type { ThoughtMapState } from '../graph/types'
import type { MapStatus } from '../graph/useThoughtMap'
import { ThoughtMap } from './ThoughtMap'

/**
 * Tracks an element's size, so the map is laid out at true pixels — every
 * frame while the panel grows or shrinks, so the map grows with it. A
 * callback ref, because the element comes and goes with the panel.
 */
const useSize = () => {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    observer.current = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.round(width), height: Math.round(height) })
    })
    observer.current.observe(el)
  }, [])
  return { ref, ...size }
}

const useViewport = () => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** The corner (about a quarter of the screen), or nearly all of it. */
const panelSize = (expanded: boolean, viewport: { width: number; height: number }) =>
  expanded
    ? { width: viewport.width - 24, height: viewport.height - 72 }
    : {
        width: Math.max(440, Math.min(viewport.width * 0.5, 820)),
        height: Math.max(340, Math.min(viewport.height * 0.5, 560)),
      }

/** Growing and shrinking: unhurried, and settling softly at the end. */
const RESIZE = { duration: 0.5, ease: [0.32, 0.72, 0, 1] as const }

interface ThoughtMapPanelProps {
  open: boolean
  onClose: () => void
  map: ThoughtMapState
  status: MapStatus
  onReshuffle: () => void
}

/**
 * The map, floating over the top-right quarter of the screen. It sits above
 * the chat rather than beside it, so opening it never reflows the
 * conversation, and the conversation stays usable beneath.
 */
export const ThoughtMapPanel = ({ open, onClose, map, status, onReshuffle }: ThoughtMapPanelProps) => {
  const { ref, width, height } = useSize()
  // A long conversation outgrows the corner; expanded, the map takes most of
  // the screen and lays itself out again.
  const [expanded, setExpanded] = useState(false)
  const size = panelSize(expanded, useViewport())
  const svgRef = useRef<HTMLDivElement>(null)
  const { graph, was, origin } = map
  const core = graph.nodes.find((n) => n.layer === 'core')
  const empty = graph.nodes.length === 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (expanded) setExpanded(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, expanded])

  const save = () => {
    const svg = svgRef.current?.querySelector('svg')
    if (!svg) return
    void saveMapCard(svg, {
      title: graph.title,
      from: core ? origin : '',
      to: core?.label ?? '',
      open: graph.frontier,
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="map"
          aria-label="Thought map"
          className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] right-3 z-40 flex origin-top-right flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_24px_64px_-24px_rgb(0_0_0/0.35)]"
          initial={{ opacity: 0, scale: 0.94, y: -6, ...size }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
            ...size,
            transition: { duration: 0.32, ease: EASE_OUT, width: RESIZE, height: RESIZE },
          }}
          exit={{ opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.16, ease: EASE_IN } }}
        >
          <header className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-4">
            <h2 className="min-w-0 truncate font-serif text-[15px] text-foreground">
              {graph.title || 'The shape of your thoughts'}
            </h2>
            <AnimatePresence>
              {status === 'drawing' && (
                <motion.span
                  className="shrink-0 text-xs text-muted-foreground"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 1, 0.4], transition: { duration: 1.8, repeat: Infinity } }}
                  exit={{ opacity: 0 }}
                >
                  drawing…
                </motion.span>
              )}
            </AnimatePresence>
            <div className="ml-auto flex shrink-0 items-center">
              <button
                onClick={onReshuffle}
                disabled={graph.nodes.length < 2}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                aria-label="Reshuffle thought map"
                title="Reshuffle"
              >
                <Shuffle className="size-4" />
              </button>
              <button
                onClick={save}
                disabled={empty}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                aria-label="Save as image"
                title="Save as image"
              >
                <Download className="size-4" />
              </button>
              <button
                onClick={() => setExpanded((e) => !e)}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                aria-label={expanded ? 'Shrink thought map' : 'Expand thought map'}
                title={expanded ? 'Shrink' : 'Expand'}
              >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <button
                onClick={onClose}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close thought map"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div ref={ref} className="relative min-h-0 flex-1">
            <div ref={svgRef} className="absolute inset-0">
              {width > 0 && height > 0 && (
                <ThoughtMap graph={graph} was={was} width={width} height={height} seed={map.seed} />
              )}
            </div>
            {empty && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-16 text-center font-serif text-[15px] text-muted-foreground italic">
                {status === 'drawing' ? '' : 'As you talk, your thoughts take shape here.'}
              </p>
            )}
          </div>

          <footer className="flex h-10 shrink-0 items-center px-4 text-xs text-muted-foreground">
            <AnimatePresence mode="wait" initial={false}>
              {core && origin && origin !== core.label ? (
                // The journey, once there is one: where it began, where it got to.
                <motion.p
                  key="arc"
                  className="min-w-0 truncate"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6, delay: 1 }}
                >
                  {origin}
                  <span className="mx-2">→</span>
                  <span className="font-medium text-(--map-core)">{core.label}</span>
                </motion.p>
              ) : (
                <motion.p
                  key="legend"
                  className="flex items-center gap-1.5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  Outer ring: what happened
                  <span className="inline-flex items-center gap-1 px-1" aria-hidden>
                    <i className="size-1.5 rounded-full bg-(--map-surface)" />
                    <i className="size-1.5 rounded-full bg-(--map-reaction)" />
                    <i className="size-1.5 rounded-full bg-(--map-belief)" />
                    <i className="size-2 rounded-full bg-(--map-core)" />
                  </span>
                  Centre: what lies underneath
                  {graph.nodes.some((n) => n.by === 'delphi') && (
                    <>
                      <i className="ml-3 size-1.5 rounded-full border border-(--map-belief)" aria-hidden />
                      <span className="italic">What Delphi saw</span>
                    </>
                  )}
                  {graph.edges.some((e) => e.kind === 'tension') && (
                    <>
                      <svg width="18" height="6" className="ml-3" aria-hidden>
                        <line x1="0" y1="3" x2="18" y2="3" stroke="var(--map-tension)" strokeWidth="1.25" strokeDasharray="4 3" />
                      </svg>
                      Pulling against each other
                    </>
                  )}
                </motion.p>
              )}
            </AnimatePresence>
          </footer>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
