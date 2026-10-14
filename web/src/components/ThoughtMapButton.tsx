import { motion, useReducedMotion } from 'framer-motion'
import { buttonVariants } from '@/components/ui/button'

interface ThoughtMapButtonProps {
  open: boolean
  /** The map changed since it was last looked at. */
  fresh: boolean
  drawing: boolean
  onClick: () => void
}

/**
 * The map's own icon: its rings. While a thought is being drawn the rings
 * breathe; when one lands and the map is closed, the centre lights up gold
 * until it's opened.
 */
export const ThoughtMapButton = ({ open, fresh, drawing, onClick }: ThoughtMapButtonProps) => {
  const reduceMotion = useReducedMotion()
  return (
    <motion.button
      onClick={onClick}
      // Styled as the header's other buttons (ghost icon Buttons).
      className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      aria-label={open ? 'Hide thought map' : 'Show thought map'}
      aria-expanded={open}
      title="Thought map"
    >
      <svg className="size-5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <motion.ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="8"
          strokeDasharray="1 3.6"
          strokeLinecap="round"
          animate={drawing && !reduceMotion ? { rotate: 360 } : { rotate: 0 }}
          transition={drawing ? { duration: 6, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
          style={{ transformOrigin: '12px 12px' }}
        />
        <ellipse cx="12" cy="12" rx="6" ry="4.8" />
        <motion.circle
          cx="12"
          cy="12"
          r="2"
          stroke="none"
          initial={false}
          animate={{
            fill: fresh ? 'var(--map-core)' : 'currentColor',
            scale: fresh && !reduceMotion ? [1, 1.5, 1] : 1,
          }}
          transition={{ scale: { duration: 1.6, repeat: fresh ? Infinity : 0 }, fill: { duration: 0.4 } }}
          style={{ transformOrigin: '12px 12px' }}
        />
      </svg>
    </motion.button>
  )
}
