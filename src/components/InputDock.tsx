import { forwardRef, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { isTouchDevice } from '../hooks/device'
import { LiquidGlassFilter, type GlassParams } from './LiquidGlass'
import { SPRING } from '../constants'

const TEXTAREA_MAX_HEIGHT = 120
const FILTER_ID = 'lg-dock'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onNewChat: () => void
  started: boolean
  disabled: boolean
  liquid: boolean
  glass: GlassParams
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export const InputDock = forwardRef<HTMLDivElement, Props>(
  ({ value, onChange, onSend, onNewChat, started, disabled, liquid, glass, textareaRef }, ref) => {
    const hasInput = value.trim().length > 0
    const fieldRef = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })

    // Track the field's border-box so the displacement map matches it exactly.
    useEffect(() => {
      if (!liquid) return
      const el = fieldRef.current
      if (!el) return
      const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
      measure()
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }, [liquid])

    const handleSend = () => {
      if (!hasInput || disabled) return
      onSend()
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      if (isTouchDevice()) textareaRef.current?.blur()
      else requestAnimationFrame(() => textareaRef.current?.focus())
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    }

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
      const el = e.target
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px'
    }

    const radius = size.h / 2 // a capsule
    const bezel = Math.min(radius, Math.max(10, size.h * 0.42))

    const fieldStyle = liquid
      ? ({ borderRadius: radius, ['--lg-spec']: glass.specular } as React.CSSProperties)
      : undefined

    return (
      <div ref={ref} className="dock">
        <AnimatePresence>
          {started && (
            <motion.button
              key="new"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={SPRING}
              whileTap={{ scale: 0.92 }}
              onClick={onNewChat}
              className="dock-new"
              aria-label="New conversation"
            >
              begin again
            </motion.button>
          )}
        </AnimatePresence>

        <div
          ref={fieldRef}
          style={fieldStyle}
          className={`dock-field ${liquid ? 'liquid' : 'glass'} ${disabled ? 'is-busy' : ''}`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask Delphi…"
            rows={1}
            className="dock-textarea"
          />
          <motion.button
            whileTap={{ scale: 0.86 }}
            transition={SPRING}
            onClick={handleSend}
            className={`dock-send ${hasInput && !disabled ? 'is-active' : ''}`}
            aria-label="Send"
          >
            <SendIcon />
          </motion.button>
        </div>

        {liquid && size.w > 4 && (
          <LiquidGlassFilter
            id={FILTER_ID}
            width={size.w}
            height={size.h}
            radius={radius}
            bezel={bezel}
            refraction={glass.refraction}
            blur={glass.blur}
            saturation={glass.saturation}
          />
        )}
      </div>
    )
  },
)

InputDock.displayName = 'InputDock'

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
)
