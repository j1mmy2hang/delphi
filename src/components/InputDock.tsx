import { forwardRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { isTouchDevice } from '../hooks/device'
import { SPRING } from '../constants'

const TEXTAREA_MAX_HEIGHT = 120

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onNewChat: () => void
  started: boolean
  disabled: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export const InputDock = forwardRef<HTMLDivElement, Props>(
  ({ value, onChange, onSend, onNewChat, started, disabled, textareaRef }, ref) => {
    const hasInput = value.trim().length > 0

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

        <div className={`dock-field glass ${disabled ? 'is-busy' : ''}`}>
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
