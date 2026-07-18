import { motion, useReducedMotion } from 'framer-motion'
import { SPRING, SPRING_SOFT } from '../constants'
import { useTheme } from '../hooks/useTheme'

/** Lucide's sun rays, drawn as one group so they retract together. */
const RAYS = [
  'M12 1v2',
  'M12 21v2',
  'M1 12h2',
  'M21 12h2',
  'M4.22 4.22l1.42 1.42',
  'M18.36 18.36l1.42 1.42',
  'M4.22 19.78l1.42-1.42',
  'M18.36 5.64l1.42-1.42',
]

/**
 * Sun ↔ moon. The disc grows and a second circle slides in from off-canvas to
 * bite a crescent out of it via a mask, while the rays retract into the middle —
 * one continuous morph rather than two icons swapping.
 *
 * Owns the theme state rather than taking it as a prop: the palette itself is
 * applied to <html> by CSS, so this icon is the only thing that re-renders.
 * Lifting it to App re-rendered the message list on every switch, which rebuilt
 * the assistant bubbles' innerHTML and made their text flicker mid-fade.
 */
export const ThemeToggle = () => {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const reduceMotion = useReducedMotion()
  const spring = reduceMotion ? { duration: 0 } : SPRING_SOFT

  return (
    <motion.button
      onClick={toggle}
      className="theme-toggle"
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <motion.svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        animate={{ rotate: isDark ? -60 : 0 }}
        transition={spring}
      >
        <mask id="delphi-crescent">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <motion.circle
            r="8.5"
            fill="black"
            animate={{ cx: isDark ? 17.5 : 32, cy: isDark ? 6.5 : -10 }}
            transition={spring}
          />
        </mask>

        <motion.circle
          cx="12"
          cy="12"
          fill="currentColor"
          mask="url(#delphi-crescent)"
          animate={{ r: isDark ? 9 : 5 }}
          transition={spring}
        />

        <motion.g
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={{ opacity: isDark ? 0 : 1, scale: isDark ? 0.4 : 1 }}
          transition={spring}
        >
          {RAYS.map((d) => (
            <path key={d} d={d} />
          ))}
        </motion.g>
      </motion.svg>
    </motion.button>
  )
}
