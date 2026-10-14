import { motion, useReducedMotion } from 'framer-motion'
import { buttonVariants } from '@/components/ui/button'

interface ThoughtRiverButtonProps {
  open: boolean
  /** The river grew since it was last looked at. */
  fresh: boolean
  drawing: boolean
  onClick: () => void
}

/**
 * The river's own icon: two lanes and the link that crosses between them.
 * While moves are being drawn the link flows; when they land and the river is
 * closed, its end lights up gold until it's opened.
 */
export const ThoughtRiverButton = ({ open, fresh, drawing, onClick }: ThoughtRiverButtonProps) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      onClick={onClick}
      // Styled as the header's other buttons (ghost icon Buttons).
      className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      aria-label={open ? 'Hide thought river' : 'Show thought river'}
      aria-expanded={open}
      title="Thought river"
    >
      <svg className="size-5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <motion.path
          d="M5 7C12 7 12 17 19 17"
          strokeLinecap="round"
          strokeDasharray={drawing && !reduceMotion ? '2 3' : undefined}
          animate={drawing && !reduceMotion ? { strokeDashoffset: [0, -10] } : { strokeDashoffset: 0 }}
          transition={drawing ? { duration: 0.8, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
        />
        <circle cx="5" cy="7" r="2.2" fill="currentColor" stroke="none" />
        <motion.circle
          cx="19"
          cy="17"
          r="2.6"
          stroke="none"
          initial={false}
          animate={{
            fill: fresh ? 'var(--river-gold)' : 'currentColor',
            scale: fresh && !reduceMotion ? [1, 1.45, 1] : 1,
          }}
          transition={{ scale: { duration: 1.6, repeat: fresh ? Infinity : 0 }, fill: { duration: 0.4 } }}
          style={{ transformOrigin: '19px 17px' }}
        />
      </svg>
    </motion.button>
  )
}
