import { forwardRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageCirclePlus } from 'lucide-react'
import { isTouchDevice } from '../hooks/device'
import { SPRING, SPRING_SOFT } from '../constants'

const TEXTAREA_MAX_HEIGHT = 120

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onNewChat: () => void
  chatStarted: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export const InputBar = forwardRef<HTMLDivElement, Props>(
  ({ value, onChange, onSend, onNewChat, chatStarted, textareaRef }, ref) => {
    const hasInput = value.trim().length > 0

    const handleSend = () => {
      if (!hasInput) return
      onSend()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      if (isTouchDevice()) {
        textareaRef.current?.blur()
      } else {
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
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
      <motion.div
        ref={ref}
        layout
        transition={SPRING_SOFT}
        className={`input-bar ${chatStarted ? 'input-bar-fixed' : 'input-bar-hero'}`}
      >
        <motion.div layout transition={SPRING_SOFT} className="input-row">
          <motion.div
            layout
            transition={SPRING_SOFT}
            className="input-field surface"
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Share anything..."
              rows={1}
              className="input-textarea"
            />
            <motion.button
              whileTap={{ scale: 0.88 }}
              transition={SPRING}
              onClick={handleSend}
              className={`send-btn ${hasInput ? 'send-btn-active' : ''}`}
              aria-label="Send"
            >
              <SendIcon />
            </motion.button>
          </motion.div>

          {/* Collapses its width and margin rather than only fading: a button
              that fades while still 48px wide releases that space in one step
              on unmount, and the field snaps out to fill it. */}
          <AnimatePresence>
            {chatStarted && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8, width: 0, marginLeft: 0 }}
                animate={{ opacity: 1, scale: 1, width: 48, marginLeft: 10 }}
                exit={{ opacity: 0, scale: 0.8, width: 0, marginLeft: 0 }}
                transition={SPRING_SOFT}
                whileTap={{ scale: 0.88 }}
                onClick={onNewChat}
                className="new-chat-btn surface"
                aria-label="New chat"
              >
                <MessageCirclePlus size={20} strokeWidth={1.8} />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    )
  }
)

InputBar.displayName = 'InputBar'

const SendIcon = () => (
  <svg
    width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
  >
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
)
