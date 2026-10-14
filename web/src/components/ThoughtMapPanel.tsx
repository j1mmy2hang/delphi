import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, X } from 'lucide-react'
import { EASE_IN, EASE_OUT } from '../constants'
import { saveMapCard } from '../graph/exportImage'
import type { ThoughtMapState } from '../graph/types'
import type { MapStatus } from '../graph/useThoughtMap'
import { ThoughtMap } from './ThoughtMap'

/**
 * Tracks an element's size, so the map is drawn at true pixels. A callback
 * ref, because the element comes and goes with the panel.
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

interface ThoughtMapPanelProps {
  open: boolean
  onClose: () => void
  map: ThoughtMapState
  status: MapStatus
}

/**
 * The map, floating over the top-right quarter of the screen. It sits above
 * the chat rather than beside it, so opening it never reflows the
 * conversation, and the conversation stays usable beneath.
 */
export const ThoughtMapPanel = ({ open, onClose, map, status }: ThoughtMapPanelProps) => {
  const { ref, width, height } = useSize()
  const svgRef = useRef<HTMLDivElement>(null)
  const { graph, was, origin } = map
  const core = graph.nodes.find((n) => n.layer === 'core')
  const empty = graph.nodes.length === 0

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
          className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] right-3 z-40 flex h-[min(50vh,560px)] min-h-[340px] w-[min(50vw,820px)] min-w-[440px] origin-top-right flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_24px_64px_-24px_rgb(0_0_0/0.35)]"
          initial={{ opacity: 0, scale: 0.94, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } }}
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
                onClick={save}
                disabled={empty}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                aria-label="Save as image"
                title="Save as image"
              >
                <Download className="size-4" />
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
                <ThoughtMap graph={graph} was={was} width={width} height={height} />
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
