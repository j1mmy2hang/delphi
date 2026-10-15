import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, Info, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react'
import { EASE_IN, EASE_OUT } from '../constants'
import { saveRiverCard } from '../river/exportImage'
import { lanesFor } from '../river/layout'
import type { Move, ThoughtRiverState } from '../river/types'
import type { RiverStatus } from '../river/useThoughtRiver'
import type { Message } from '../types'
import { ThoughtRiver } from './ThoughtRiver'

/**
 * Tracks an element's size, so the river is laid out at true pixels — every
 * frame while the panel grows or shrinks, so the river grows with it. A
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

/** What was actually said in a message, for quoting it. */
const said = (content: string) => content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

interface ThoughtRiverPanelProps {
  open: boolean
  onClose: () => void
  state: ThoughtRiverState
  status: RiverStatus
  /** Tries again after a failed draw or reflection. */
  onRetry: () => void
  /** Clears the river and draws it again from the whole conversation. */
  onRedraw: () => void
  /** The conversation, so a selected move can quote the message it came from. */
  messages: Message[]
}

/**
 * The river, floating over the top-right of the screen. It sits above the
 * chat rather than beside it, so opening it never reflows the conversation,
 * and the conversation stays usable beneath. Time runs right; it scrolls
 * sideways, and keeps the newest moves in view as they arrive.
 */
export const ThoughtRiverPanel = ({ open, onClose, state, status, onRetry, onRedraw, messages }: ThoughtRiverPanelProps) => {
  const { ref, width, height } = useSize()
  // Leave room under the river for a horizontal scrollbar.
  const riverHeight = Math.max(0, height - 8)
  // The lanes' names, where layoutRiver puts the lanes (it lays out at the
  // river's zoom, which scales heights evenly, so shares carry over).
  const zoom = Math.min(1.3, Math.max(1, Math.min(width / 820, riverHeight / 520)))
  const lanes = lanesFor(riverHeight / zoom)
  const laneNames = [
    ['You', lanes.user * zoom],
    ['Delphi', lanes.delphi * zoom],
  ] as const
  // A long conversation outgrows the corner; expanded, the river takes most
  // of the screen.
  const [expanded, setExpanded] = useState(false)
  const size = panelSize(expanded, useViewport())
  // While the panel grows or shrinks, the river follows its size frame by
  // frame; gliding each frame toward a target that moves again next frame
  // only makes it trail and snap.
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    setResizing(true)
    const t = setTimeout(() => setResizing(false), RESIZE.duration * 1000 + 80)
    return () => clearTimeout(t)
  }, [expanded])
  const [selected, setSelected] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { river } = state
  const { moves } = river
  const empty = moves.length === 0
  const move = moves.find((m) => m.id === selected)
  const content = useRef<HTMLDivElement>(null)

  // Where the selected move's dot is, within the scrolling river, so its card
  // opens beside it and scrolls with it.
  const [anchor, setAnchor] = useState<{ x: number; y: number; left: boolean } | null>(null)
  useLayoutEffect(() => {
    const dot = selected ? content.current?.querySelector(`[data-move="${selected}"]`) : null
    const el = scroller.current
    if (!dot || !el || !content.current) return setAnchor(null)
    const d = dot.getBoundingClientRect()
    const c = content.current.getBoundingClientRect()
    const x = d.left + d.width / 2 - c.left
    // Open toward whichever side of the view has more room.
    const left = x - el.scrollLeft > el.clientWidth / 2
    setAnchor({ x, y: d.top + d.height / 2 - c.top, left })
  }, [selected, width, height, moves])

  // Opening the panel on a river that failed to draw tries again, once.
  const failed = status === 'failed'
  useEffect(() => {
    if (open && failed) onRetry()
    // Only on opening: a retry that fails again waits for the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // A different river (another conversation): nothing selected in it.
  const riverKey = `${moves[0]?.id}:${moves[0]?.label}`
  useEffect(() => setSelected(null), [riverKey])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else if (expanded) setExpanded(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, expanded, selected])

  // Follow the river's end: on opening, and whenever it grows.
  const count = moves.length
  const shownCount = useRef(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !open) {
      shownCount.current = 0
      return
    }
    // Glide along when the river grows; when the panel resizes, stay pinned to
    // the end, as a smooth scroll restarted every frame stutters.
    const grew = shownCount.current !== 0 && count > shownCount.current
    shownCount.current = count
    el.scrollTo({ left: el.scrollWidth, behavior: grew ? 'smooth' : 'auto' })
  }, [count, open, width])

  // A mouse wheel scrolls through time, as there's nothing to scroll down to.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Over a move's card, the wheel is the card's: it scrolls its text.
      if ((e.target as Element).closest('[data-move-card]')) return
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const save = () => {
    const svg = scroller.current?.querySelector('svg')
    if (!svg) return
    void saveRiverCard(svg, {
      title: river.title,
      insight: river.insight,
      lanes: laneNames.map(([name, y]) => ({ name, y })),
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="river"
          aria-label="Thought river"
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
              {river.title || 'The shape of your thinking'}
            </h2>
            <AnimatePresence>
              {(status === 'drawing' || status === 'reflecting') && (
                <motion.span
                  key={status}
                  className="shrink-0 text-xs text-muted-foreground"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 1, 0.4], transition: { duration: 1.8, repeat: Infinity } }}
                  exit={{ opacity: 0 }}
                >
                  {status === 'drawing' ? 'drawing…' : 'reflecting…'}
                </motion.span>
              )}
            </AnimatePresence>
            {failed && !empty && (
              <button
                onClick={onRetry}
                className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                couldn't update · try again
              </button>
            )}
            <div className="ml-auto flex shrink-0 items-center">
              <button
                onClick={() => {
                  setSelected(null)
                  onRedraw()
                }}
                disabled={status === 'drawing'}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                aria-label="Redraw thought river"
                title="Redraw"
              >
                <RotateCcw className="size-4" />
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
                aria-label={expanded ? 'Shrink thought river' : 'Expand thought river'}
                title={expanded ? 'Shrink' : 'Expand'}
              >
                {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <button
                onClick={onClose}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close thought river"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>
          {/* What the last reflection saw: the river, said in a sentence. */}
          <AnimatePresence initial={false} mode="wait">
            {river.insight && (
              <motion.p
                key={river.insight}
                className={`-mt-1 shrink-0 px-4 pb-1.5 font-serif text-[14px] leading-snug text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
              >
                {river.insight}
              </motion.p>
            )}
          </AnimatePresence>

          <div ref={ref} className="relative min-h-0 flex-1">
            <div
              ref={scroller}
              // The scrollbar would blink on and off as the river and the
              // panel trade places mid-resize; its room is kept either way.
              className={`absolute inset-0 overflow-x-auto overflow-y-hidden ${resizing ? '[scrollbar-width:none]' : '[scrollbar-width:thin]'}`}
            >
              <div ref={content} className="relative h-full w-max">
                {width > 0 && height > 0 && !empty && (
                  <ThoughtRiver
                    river={river}
                    width={width}
                    height={riverHeight}
                    selected={selected}
                    onSelect={setSelected}
                    instant={resizing}
                  />
                )}
                <AnimatePresence>
                  {move && anchor && (
                    <MoveCard
                      key={move.id}
                      move={move}
                      moves={moves}
                      message={messages[move.at - 1]?.content ?? ''}
                      anchor={anchor}
                      height={riverHeight}
                      onSelect={setSelected}
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
            {/* The lanes' names stay put while the river scrolls beneath. */}
            {!empty && (
              <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-background from-55% to-transparent">
                {laneNames.map(([name, y]) => (
                  <span
                    key={name}
                    className="absolute left-4 -translate-y-1/2 font-serif text-sm text-foreground"
                    style={{ top: Math.round(y) }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
            {!empty && <Legend />}
            {empty && !failed && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-16 text-center font-serif text-[15px] text-muted-foreground italic">
                {status === 'drawing' ? '' : 'As you talk, the shape of your thinking appears here.'}
              </p>
            )}
            {empty && failed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-16 text-center">
                <p className="font-serif text-[15px] text-muted-foreground">Couldn't draw the river this time.</p>
                <button
                  onClick={onRetry}
                  className="rounded-full border border-border px-3.5 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

        </motion.section>
      )}
    </AnimatePresence>
  )
}

const KIND_NAME = {
  question: 'Question',
  claim: 'Claim',
  evidence: 'Example',
  realization: 'Realization',
} as const

/**
 * How a neighbouring move relates, read with the open move as the subject:
 * this move "answers" an incoming one; an outgoing one is "answered by" it.
 */
const RELATION = {
  Incoming: { builds: 'builds on', answers: 'answers', challenges: 'challenges' },
  Outgoing: { builds: 'built on by', answers: 'answered by', challenges: 'challenged by' },
} as const

const CARD_WIDTH = 300

/**
 * A move, opened: what it was, the message it came from in full, and the
 * moves around it — what it grew from and what came of it — each a step
 * further along the river.
 */
const MoveCard = ({
  move,
  moves,
  message,
  anchor,
  height,
  onSelect,
}: {
  move: Move
  moves: Move[]
  message: string
  anchor: { x: number; y: number; left: boolean }
  height: number
  onSelect: (id: string) => void
}) => {
  const byId = new Map(moves.map((m) => [m.id, m]))
  const from = move.rests.flatMap((r) => {
    const m = byId.get(r.on)
    return m ? [{ m, how: r.how }] : []
  })
  const to = moves.flatMap((m) => {
    const r = m.rests.find((x) => x.on === move.id)
    return r ? [{ m, how: r.how }] : []
  })
  const realization = move.kind === 'realization'
  const replacement = move.revisedBy ? byId.get(move.revisedBy) : undefined
  const replaced = moves.filter((m) => m.revisedBy === move.id)
  const gap = 18
  return (
    <motion.div
      data-move-card
      className="absolute top-3 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_16px_40px_-16px_rgb(0_0_0/0.35)]"
      style={{
        width: CARD_WIDTH,
        maxHeight: height - 24,
        left: anchor.left ? anchor.x - gap - CARD_WIDTH : anchor.x + gap,
      }}
      initial={{ opacity: 0, x: anchor.left ? 8 : -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: EASE_OUT }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="overflow-y-auto overscroll-contain px-4 pt-3 pb-4 [scrollbar-width:thin]">
        <p className="text-[11px] text-muted-foreground">
          <span className={realization ? 'font-medium text-(--river-gold)' : ''}>{KIND_NAME[move.kind]}</span>
          {' · '}
          {move.by === 'user' ? 'You' : 'Delphi'}, message {move.at}
        </p>
        <h3 className="mt-1 font-serif text-[17px] leading-snug text-foreground">{move.label}</h3>
        {message && <Quote text={said(message)} />}
        {replacement && <Turn title="Later let go, for" moves={[replacement]} onSelect={onSelect} />}
        {replaced.length > 0 && <Turn title="Moved on from" moves={replaced} onSelect={onSelect} />}
        {from.length > 0 && <MoveList title="Incoming" items={from} onSelect={onSelect} />}
        {to.length > 0 && <MoveList title="Outgoing" items={to} onSelect={onSelect} />}
      </div>
    </motion.div>
  )
}

/** The message a move came from: six lines, and the rest on asking. */
const Quote = ({ text }: { text: string }) => {
  const [all, setAll] = useState(false)
  const ref = useRef<HTMLQuoteElement>(null)
  const [long, setLong] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setLong(el.scrollHeight > el.clientHeight + 1)
  }, [text])
  return (
    <div className="mt-2.5">
      <blockquote
        ref={ref}
        className={`border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground ${all ? '' : 'line-clamp-6'}`}
      >
        {text}
      </blockquote>
      {(long || all) && (
        <button
          onClick={() => setAll(!all)}
          className="mt-1 pl-3 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

const MoveList = ({
  title,
  items,
  onSelect,
}: {
  title: keyof typeof RELATION
  items: { m: Move; how: Move['rests'][number]['how'] }[]
  onSelect: (id: string) => void
}) => (
  <div className="mt-3">
    <p className="text-[11px] font-medium text-foreground">{title}</p>
    <ul className="mt-1 space-y-0.5">
      {items.map(({ m, how }) => (
        <li key={m.id}>
          <button
            onClick={() => onSelect(m.id)}
            className="w-full rounded-md px-1.5 py-1 -mx-1.5 text-left text-[12.5px] leading-snug text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <span className="mr-1.5 text-[11px]">{RELATION[title][how]}</span>
            <span className={m.kind === 'realization' ? 'text-(--river-gold)' : 'text-foreground'}>{m.label}</span>
          </button>
        </li>
      ))}
    </ul>
  </div>
)

/** A turn in the user's position: what this move gave way to, or what it replaced. */
const Turn = ({ title, moves, onSelect }: { title: string; moves: Move[]; onSelect: (id: string) => void }) => (
  <div className="mt-3">
    <p className="text-[11px] font-medium text-foreground">{title}</p>
    <ul className="mt-1 space-y-0.5">
      {moves.map((m) => (
        <li key={m.id}>
          <button
            onClick={() => onSelect(m.id)}
            className="w-full rounded-md px-1.5 py-1 -mx-1.5 text-left text-[12.5px] leading-snug text-foreground transition-colors hover:bg-secondary"
          >
            {m.label}
          </button>
        </li>
      ))}
    </ul>
  </div>
)

const Key = ({ mark, children }: { mark: ReactNode; children: string }) => (
  <li className="flex items-center gap-2.5">
    <svg width="16" height="10" className="shrink-0 overflow-visible" aria-hidden>
      {mark}
    </svg>
    {children}
  </li>
)

/**
 * What the marks mean, out of the way until it's wanted: a small button in
 * the corner, and the key on hover (or focus, or a tap).
 */
const Legend = () => (
  <div className="group absolute bottom-3 left-3 z-20">
    <button
      className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:text-foreground focus-visible:text-foreground"
      aria-label="Legend"
    >
      <Info className="size-4" />
    </button>
    <ul className="pointer-events-none absolute bottom-full left-0 mb-1.5 flex w-max translate-y-1 flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-xs text-muted-foreground opacity-0 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)] transition duration-150 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
      <Key mark={<circle cx="8" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />}>Question</Key>
      <Key mark={<circle cx="8" cy="5" r="2.5" fill="currentColor" />}>Claim</Key>
      <Key mark={<rect x="5.5" y="2.5" width="5" height="5" transform="rotate(45 8 5)" fill="currentColor" />}>Example</Key>
      <Key mark={<circle cx="8" cy="5" r="4.5" fill="var(--river-gold)" />}>Realization</Key>
      <li className="my-0.5 border-t border-border" aria-hidden />
      <Key mark={<line x1="0" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.1" />}>Builds on</Key>
      <Key mark={<line x1="0" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.1" strokeDasharray="4 3" />}>Challenges</Key>
      <Key mark={<line x1="0" y1="5" x2="16" y2="5" stroke="var(--river-gold)" strokeWidth="1.4" />}>Leads to a realization</Key>
      <Key
        mark={<line x1="0" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1 3.5" strokeLinecap="round" />}
      >
        Moved on from
      </Key>
    </ul>
  </div>
)
