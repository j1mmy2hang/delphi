import { motion } from 'framer-motion'
import type { Message } from '../types'
import { renderBasicMarkdown, stripAngleTags } from '../utils/markdown'
import { SPRING_SOFT } from '../constants'

interface Props {
  message: Message
  registerRef: (el: HTMLDivElement | null) => void
}

export const MessageItem = ({ message, registerRef }: Props) => {
  const isUser = message.role === 'user'
  const hasContent = message.content.trim().length > 0

  return (
    <motion.div
      ref={registerRef}
      className={`msg-row ${isUser ? 'msg-row-user' : 'msg-row-assistant'}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_SOFT}
    >
      {isUser ? (
        <div className="bubble bubble-user">{message.content}</div>
      ) : (
        <div className="assistant">
          <div className="assistant-mark" aria-hidden="true">δ</div>
          <div className="bubble bubble-assistant">
            {hasContent ? (
              <div
                className="markdown"
                dangerouslySetInnerHTML={{
                  __html: renderBasicMarkdown(stripAngleTags(message.content)),
                }}
              />
            ) : (
              <LoadingDots />
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}

const LoadingDots = () => (
  <div className="loading-dots" aria-label="Loading">
    <span /><span /><span />
  </div>
)
