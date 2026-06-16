import { motion } from 'framer-motion'
import { EASE_SETTLE, STAGE } from '../constants'

/**
 * The just-sent words lift out of the input and ascend to the stage's resting
 * centre, growing from input-size into the serif as they travel. It lands
 * pixel-identical to MessageStage's user text, so the hand-off is invisible.
 */
interface Props {
  text: string
  startY: number // px offset from the resting centre down to the input
  startScale: number
  onArrived: () => void
}

export const AscendingMessage = ({ text, startY, startScale, onArrived }: Props) => (
  <div className="stage-wrap ascend-wrap" aria-hidden="true">
    <motion.p
      className="stage-text"
      initial={{ y: startY, scale: startScale, opacity: 0.4, filter: 'blur(1.5px)' }}
      animate={{ y: 0, scale: 1, opacity: 1, filter: 'blur(0px)' }}
      transition={{ duration: STAGE.RISE, ease: EASE_SETTLE }}
      onAnimationComplete={onArrived}
    >
      {text}
    </motion.p>
  </div>
)
