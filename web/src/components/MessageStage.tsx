import { useEffect, useRef } from 'react'
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  type AnimationPlaybackControls,
} from 'framer-motion'
import { renderParagraphs, stripAngleTags } from '../utils/markdown'
import { StageText } from './StageText'
import { EASE, EASE_SETTLE, STAGE } from '../constants'

export type Phase =
  | 'idle'
  | 'rising'
  | 'thinking'
  | 'dissolving'
  | 'forming'
  | 'settled'

interface Props {
  role: 'idle' | 'user' | 'assistant'
  text: string
  phase: Phase
}

type Bezier = [number, number, number, number]

const FILTER_REF = 'url(#mist) '
const REST = { opacity: 1, blur: 0, y: 0, scale: 1, turb: 0 }
// Every message — question or reply — materialises out of the cloud and melts
// back into it the same way, slowly and visibly.
const ENTER = { opacity: 0, blur: 22, y: 12, scale: 0.9, turb: 42 }
const EXIT = { opacity: 0, blur: 22, y: -10, scale: 1.12, turb: 46 }

export const MessageStage = ({ role, text, phase }: Props) => {
  const opacity = useMotionValue(0)
  const blur = useMotionValue(ENTER.blur)
  const y = useMotionValue(ENTER.y)
  const scale = useMotionValue(ENTER.scale)
  const turb = useMotionValue(ENTER.turb)
  const dispUrl = useMotionValue('') // '' or FILTER_REF — only filter while morphing
  const filter = useMotionTemplate`${dispUrl}blur(${blur}px)`

  const dispRef = useRef<SVGFEDisplacementMapElement>(null)
  const controls = useRef<AnimationPlaybackControls[]>([])
  const mv = { opacity, blur, y, scale, turb }

  // Drive the displacement-map strength from the `turb` motion value.
  useEffect(() => turb.on('change', v => dispRef.current?.setAttribute('scale', String(v))), [turb])

  useEffect(() => {
    controls.current.forEach(c => c.stop())
    controls.current = []

    const enableMist = () => dispUrl.set(FILTER_REF)
    const disableMist = () => dispUrl.set('')

    type Opts = { duration: number; ease: Bezier; onComplete?: () => void }
    const run = (target: Partial<typeof REST>, opts: Opts, onDone?: () => void) => {
      Object.entries(target).forEach(([k, val], i) => {
        const o = i === 0 && onDone ? { ...opts, onComplete: onDone } : opts
        controls.current.push(animate(mv[k as keyof typeof mv], val as number, o))
      })
    }

    const materialise = (duration: number) => {
      enableMist()
      opacity.set(ENTER.opacity)
      blur.set(ENTER.blur)
      y.set(ENTER.y)
      scale.set(ENTER.scale)
      turb.set(ENTER.turb)
      run(REST, { duration, ease: EASE_SETTLE }, disableMist)
    }

    switch (phase) {
      case 'idle': // Delphi wordmark coalesces out of the cloud on load
        materialise(1.4)
        break
      // 'rising' (the user's question) is handled by the AscendingMessage overlay,
      // which flies it up from the input; here we only form replies & the wordmark.
      case 'forming': // the reply materialises out of the cloud
        materialise(STAGE.FORM)
        break
      case 'dissolving': // the message melts back into the wave
        enableMist()
        run(EXIT, { duration: STAGE.DISSOLVE, ease: EASE })
        break
      case 'thinking':
      case 'settled':
        disableMist()
        opacity.set(1)
        blur.set(0)
        y.set(0)
        scale.set(1)
        turb.set(0)
        break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <>
      <svg className="stage-defs" width="0" height="0" aria-hidden="true">
        <defs>
          <filter id="mist" x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves={2} seed={7} result="n" />
            <feDisplacementMap ref={dispRef} in="SourceGraphic" in2="n" scale={0} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <motion.div className="stage" style={{ opacity, y, scale, filter }}>
        {role === 'idle' ? (
          <div className="stage-idle">
            <h1 className="stage-wordmark">Delphi</h1>
            <p className="stage-subtitle">Think Deeper, Clearer, Better</p>
          </div>
        ) : role === 'user' ? (
          <StageText html={renderParagraphs(text)} />
        ) : (
          <StageText className="markdown" html={renderParagraphs(stripAngleTags(text), true)} />
        )}
      </motion.div>
    </>
  )
}
