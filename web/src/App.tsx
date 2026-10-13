import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpIcon, MessageCirclePlus } from 'lucide-react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import { Hero, HeroCredit } from './components/Hero'
import { LoadingState } from './components/LoadingState'
import { ScrollPastEnd } from './components/ScrollPastEnd'
import { ThemeToggle } from './components/ThemeToggle'
import { EASE_IN, EASE_OUT, SPRING_GLIDE } from './constants'
import { useChatStream } from './hooks/useChatStream'
import { stripAngleTags } from './utils/markdown'

function App() {
  const [input, setInput] = useState('')
  const { messages, isStreaming, send, stop, reset } = useChatStream()
  const chatStarted = messages.length > 0

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    setInput('')
    send(trimmed)
  }

  const handleNewChat = () => {
    reset()
    setInput('')
  }

  // App shell, as ChatGPT and Claude do it: exactly one screen tall (dvh tracks
  // the browser's collapsing toolbars), the message list is the one scroller,
  // and the composer sits below it in normal flow. relative: popLayout
  // positions exiting elements against this box.
  return (
    <div className="relative mx-auto flex h-dvh w-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between px-3">
        <AnimatePresence>
          {chatStarted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Button variant="ghost" size="icon" onClick={handleNewChat} aria-label="New chat">
                <MessageCirclePlus className="size-5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      {/* Home → chat, engineered so the composer is the only thing that moves
          through space:
          - The hero and credit exit in `popLayout` mode: they're lifted out of
            the flow the instant chat starts, so the composer is measured once
            against the final layout and glides there in a single motion,
            instead of being pushed again when each exit finishes.
          - They fade fast and early; the first message fades in a beat later,
            while the composer is still travelling down.
          - The reverse (new chat) runs the same choreography backwards. */}
      {!chatStarted && <div className="flex-[1_1_0]" />}

      <AnimatePresence mode="popLayout">
        {chatStarted && (
          <motion.div
            key="conversation"
            className="flex min-h-0 flex-1 flex-col"
            exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE_IN } }}
          >
            {/* Native scrolling: "instant" turns off the library's spring-
                animated scroll, which took over near the bottom. It still
                follows a streaming reply while you're at the bottom. */}
            <Conversation className="min-h-0" initial="instant" resize="instant">
              <ConversationContent
                // The one scroller: a scroll that hits its end stops there
                // rather than carrying on to the page.
                scrollClassName="overscroll-y-contain"
                className="mx-auto w-full max-w-3xl px-5 pt-2 pb-8"
              >
                {messages.map((message, i) => {
                  const text =
                    message.role === 'assistant'
                      ? stripAngleTags(message.content)
                      : message.content
                  // The opening exchange waits for the hero to clear; later
                  // turns appear at once. A reply trails its question slightly.
                  const delay = (i < 2 ? 0.12 : 0) + (message.role === 'assistant' ? 0.12 : 0)
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, ease: EASE_OUT, delay }}
                    >
                      <Message from={message.role}>
                        <MessageContent className="text-base leading-relaxed">
                          {message.role === 'user' ? (
                            <p className="whitespace-pre-wrap">{text}</p>
                          ) : text ? (
                            <MessageResponse>{text}</MessageResponse>
                          ) : (
                            <LoadingState />
                          )}
                        </MessageContent>
                      </Message>
                    </motion.div>
                  )
                })}
                <ScrollPastEnd />
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </motion.div>
        )}
      </AnimatePresence>

      {/* initial={false}: on first load the hero is simply there; the entrance
          only plays when returning from a chat. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {!chatStarted && (
          <motion.div
            key="hero"
            className="mb-8"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT, delay: 0.12 } }}
            exit={{ opacity: 0, y: -12, transition: { duration: 0.18, ease: EASE_IN } }}
          >
            <Hero />
          </motion.div>
        )}
      </AnimatePresence>

      {/* layout="position": a size change would be animated as a scale and
          stretch the text. layoutDependency: only the home ↔ chat switch
          animates — a draft growing a line resizes in place, as it should. */}
      <motion.div
        layout="position"
        layoutDependency={chatStarted}
        transition={SPRING_GLIDE}
        className="composer mx-auto w-full max-w-3xl shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {/* One row: the field and its button side by side. The textarea sizes
            to its content, so it stays a single line until the text wraps; the
            button then holds to the bottom edge. */}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="Say what's on your mind..."
            rows={1}
            className="max-h-48 min-h-0 py-3.5 pr-2"
          />
          {/* While streaming it's a stop button, not a submit — so Enter in
              the textarea can't stop a reply or clear the draft. */}
          {isStreaming ? (
            <PromptInputSubmit
              status="streaming"
              type="button"
              onClick={stop}
              aria-label="Stop"
              className="composer-send"
            />
          ) : (
            <PromptInputSubmit
              status="ready"
              disabled={!input.trim()}
              className="composer-send"
            >
              <ArrowUpIcon className="size-4" />
            </PromptInputSubmit>
          )}
        </PromptInput>
      </motion.div>

      <AnimatePresence mode="popLayout" initial={false}>
        {!chatStarted && (
          <motion.div
            key="credit"
            className="flex-[1.4_1_0]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.4, ease: EASE_OUT, delay: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_IN } }}
          >
            <HeroCredit />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
