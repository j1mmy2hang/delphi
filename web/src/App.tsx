import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpIcon, MessageCirclePlus, PanelLeft } from 'lucide-react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Hero } from './components/Hero'
import { FirstOnScreen } from './components/FirstOnScreen'
import { HomeNote } from './components/HomeNote'
import { HistorySidebar } from './components/HistorySidebar'
import { LoadingState } from './components/LoadingState'
import { ReplyFailure } from './components/ReplyFailure'
import { isSaveStatusOmitted, SaveStatus } from './components/SaveStatus'
import { ScrollEdge } from './components/ScrollEdge'
import { ScrollPastEnd } from './components/ScrollPastEnd'
import { StreamingReply } from './components/StreamingReply'
import { ThemeToggle } from './components/ThemeToggle'
import { ThoughtRiverButton } from './components/ThoughtRiverButton'
import { ThoughtRiverPanel } from './components/ThoughtRiverPanel'
import { EASE_IN, EASE_OUT, FLOATING_BUTTON, SPRING_GLIDE } from './constants'
import { useChatStream } from './hooks/useChatStream'
import { useConversationLibrary, type LibraryEntry } from './hooks/useConversationLibrary'
import { useMobileViewport } from './hooks/useMobileViewport'
import { useThoughtRiver } from './river/useThoughtRiver'
import { localISO, titleFrom } from './storage/conversationFile'
import type { Message as ChatMessage } from './types'
import { newId } from './utils/id'
import { stripAngleTags } from './utils/markdown'

function App() {
  const [input, setInput] = useState('')
  const { messages, isStreaming, send, retry, stop, reset, load } = useChatStream()
  const chatStarted = messages.length > 0

  useMobileViewport()

  const library = useConversationLibrary()
  const { save, generation } = library
  // Identity of the conversation on screen. Set on its first message (or when
  // a saved one is opened); null on the home screen.
  const [meta, setMeta] = useState<{ id: string; created: string; title?: string } | null>(null)
  // What was last written, and to which folder (generation) — so a re-render
  // never rewrites a file, but switching folders writes the open conversation
  // into the new one.
  const savedRef = useRef<{ messages: ChatMessage[]; generation: number } | null>(null)
  // Closed on every visit; opened from the header button or the save status.
  const [historyOpen, setHistoryOpen] = useState(false)
  const showHistory = library.status === 'ready' && historyOpen

  const toggleHistory = (open = !historyOpen) => setHistoryOpen(open)

  // The thought river: drawn beside the chat by a second model, once each
  // reply is complete. The button lights up when it grows unseen.
  const river = useThoughtRiver(messages, meta?.id ?? null, isStreaming)
  const [riverOpen, setRiverOpen] = useState(false)
  const [riverSeen, setRiverSeen] = useState(0)
  useEffect(() => {
    if (riverOpen) setRiverSeen(river.version)
  }, [riverOpen, river.version])
  const riverFresh = !riverOpen && river.version > riverSeen && river.river.moves.length > 0

  // Write the question as soon as it's sent, and the reply once it's complete
  // (or stopped) — not on every streamed token. Choosing a folder mid-chat
  // makes `save` live, which saves the conversation already on screen.
  useEffect(() => {
    const saved = savedRef.current
    if (!meta || (saved?.messages === messages && saved.generation === generation)) return
    const last = messages.at(-1)
    const justSent = last?.role === 'assistant' && last.content === ''
    if (isStreaming && !justSent) return
    // Text only: a failure notice is UI, and a reply that failed before its
    // first word has nothing to keep.
    const keep = messages
      .filter((m) => m.content.trim())
      .map(({ role, content }): ChatMessage => ({ role, content }))
    if (keep.length === 0) return
    savedRef.current = { messages, generation }
    save({
      id: meta.id,
      created: meta.created,
      title: meta.title ?? titleFrom(keep),
      updated: localISO(),
      messages: keep,
    })
  }, [messages, isStreaming, meta, save, generation])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    setInput('')
    if (!meta) {
      setMeta({ id: newId(), created: localISO() })
      setOpenedCount(null)
    }
    send(trimmed)
  }

  // How many messages came from a saved file when it was opened (null for a
  // conversation started here). Those enter as a cascade, not as live turns.
  const [openedCount, setOpenedCount] = useState<number | null>(null)
  // The first of those on screen once it has settled at its end (FirstOnScreen);
  // null until measured, and the opened messages wait hidden till then.
  const [cascadeFrom, setCascadeFrom] = useState<number | null>(null)
  const opened = (i: number) => openedCount !== null && i < openedCount

  /**
   * When each message fades in. Live: the opening exchange waits for the hero
   * to clear, later turns appear at once, and a reply trails its question.
   * Opened from history: strictly top to bottom, starting from the first
   * message on screen; the ones scrolled out of view above appear at once.
   */
  const entranceDelay = (i: number, role: ChatMessage['role']) => {
    if (opened(i)) return 0.08 + Math.max(0, i - (cascadeFrom ?? 0)) * 0.05
    return (i < 2 ? 0.12 : 0) + (role === 'assistant' ? 0.12 : 0)
  }

  const handleNewChat = () => {
    setOpenedCount(null)
    reset()
    setInput('')
    setMeta(null)
    setRiverOpen(false)
    setRiverSeen(0)
    savedRef.current = null
  }

  const handleDelete = async (entry: LibraryEntry) => {
    // Deleting the conversation on screen leaves nothing to continue.
    if (entry.id === meta?.id) handleNewChat()
    await library.remove(entry)
  }

  const handleOpen = async (entry: LibraryEntry) => {
    if (entry.id === meta?.id) return
    const conversation = await library.open(entry)
    if (!conversation) return
    savedRef.current = { messages: conversation.messages, generation }
    setMeta({ id: conversation.id, created: conversation.created, title: conversation.title })
    setOpenedCount(conversation.messages.length)
    setCascadeFrom(null)
    load(conversation.messages)
    setInput('')
  }

  // App shell, as ChatGPT and Claude do it: exactly one screen tall (dvh tracks
  // the browser's collapsing toolbars), the message list is the one scroller,
  // and the composer sits below it in normal flow. relative: popLayout
  // positions exiting elements against this box.
  return (
    // --app-height: the space the keyboard leaves on phones (useMobileViewport);
    // unset everywhere else, so desktop is plain 100dvh.
    <div className="flex h-(--app-height,100dvh) w-full">
      {library.status === 'ready' && (
        <HistorySidebar
          open={showHistory}
          folderName={library.folderName}
          entries={library.entries}
          currentId={meta?.id ?? null}
          onSelect={handleOpen}
          onDelete={handleDelete}
          onChangeFolder={() => library.chooseFolder()}
          onUnlink={library.unlink}
        />
      )}
      <ThoughtRiverPanel
        open={riverOpen && chatStarted}
        onClose={() => setRiverOpen(false)}
        state={river}
        status={river.status}
        messages={messages}
      />
      <div className="relative mx-auto flex h-(--app-height,100dvh) min-w-0 flex-1 flex-col overflow-hidden">
        {/* Safe-area insets keep the header clear of the notch (landscape, or
            added to the Home Screen); they're zero on desktop. */}
        {/* Phones: no bar — the header lifts out of the layout and its
            buttons float over the conversation, which scrolls the full height
            beneath them. The header itself lets touches through; only the
            buttons take them. */}
        <header className="pointer-coarse:pointer-events-none relative flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center pt-[env(safe-area-inset-top)] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] pointer-coarse:absolute pointer-coarse:inset-x-0 pointer-coarse:top-0 pointer-coarse:z-20">
          {library.status === 'ready' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => toggleHistory()}
              aria-label={showHistory ? 'Hide conversations' : 'Show conversations'}
              aria-expanded={showHistory}
            >
              <PanelLeft className="size-5" />
            </Button>
          )}
          <AnimatePresence>
            {chatStarted && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleNewChat}
                  aria-label="New chat"
                  className={cn('pointer-events-auto', FLOATING_BUTTON)}
                >
                  <MessageCirclePlus className="size-5" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="pointer-events-auto ml-auto flex items-center gap-1">
            {/* Desktop only for now: phones have no room for the panel. */}
            <AnimatePresence>
              {chatStarted && (
                <motion.div
                  className="pointer-coarse:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <ThoughtRiverButton
                    open={riverOpen}
                    fresh={riverFresh}
                    drawing={river.status === 'drawing'}
                    onClick={() => setRiverOpen((o) => !o)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <ThemeToggle />
          </div>
        </header>

        {/* Home → chat, engineered so the composer is the only thing that moves
            through space:
            - The hero exits in `popLayout` mode: it's lifted out of the flow the
              instant chat starts, so the composer is measured once against the
              final layout and glides there in a single motion, instead of being
              pushed again when the exit finishes.
            - It fades fast and early; the first message fades in a beat later,
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
              {/* Your own scrolling is always native. `resize` only governs the
                  follow-the-reply scroll while you're at the bottom: "smooth"
                  eases it with the library's spring, where "instant" jumped a
                  whole line in one frame each time the reply wrapped. `initial`
                  stays instant, so an opened conversation starts at its end. */}
              <Conversation key={meta?.id} className="min-h-0" initial="instant" resize="smooth">
                <ConversationContent
                  // The one scroller: a scroll that hits its end stops there
                  // rather than carrying on to the page.
                  scrollClassName="overscroll-y-contain"
                  // Phones: room at the top for the floating buttons, which the
                  // messages scroll up beneath. And always 1px taller than the
                  // list, so it's always scrollable: iOS only rubber-bands a
                  // scroller with overflow, so a short conversation felt dead.
                  className="mx-auto w-full max-w-3xl px-5 pt-2 pb-8 pointer-coarse:min-h-[calc(100%+1px)] pointer-coarse:pt-[calc(4rem+env(safe-area-inset-top))]"
                >
                  {messages.map((message, i) => {
                    const text =
                      message.role === 'assistant'
                        ? stripAngleTags(message.content)
                        : message.content
                    const delay = entranceDelay(i, message.role)
                    const waiting = opened(i) && cascadeFrom === null
                    return (
                      <motion.div
                        key={i}
                        data-message={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={waiting ? { opacity: 0, y: 8 } : { opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: EASE_OUT, delay }}
                      >
                        <Message from={message.role}>
                          <MessageContent className="text-base leading-relaxed">
                            {message.role === 'user' ? (
                              <p className="whitespace-pre-wrap">{text}</p>
                            ) : (
                              <>
                                {text && (
                                  <StreamingReply
                                    text={text}
                                    streaming={isStreaming && i === messages.length - 1}
                                  />
                                )}
                                {message.error ? (
                                  <ReplyFailure
                                    failure={message.error}
                                    active={i === messages.length - 1}
                                    onRetry={retry}
                                    onNewChat={handleNewChat}
                                  />
                                ) : (
                                  !text && <LoadingState />
                                )}
                              </>
                            )}
                          </MessageContent>
                        </Message>
                      </motion.div>
                    )
                  })}
                  <ScrollPastEnd />
                  {openedCount !== null && <FirstOnScreen onMeasure={setCascadeFrom} />}
                  <ScrollEdge />
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
          className={cn(
            'composer mx-auto w-full max-w-3xl shrink-0 px-4',
            // In a chat the block sits off the bottom edge with some room,
            // rather than resting on it.
            chatStarted
              ? 'pb-[max(1.75rem,calc(env(safe-area-inset-bottom)+0.75rem))]'
              : 'pb-[max(1rem,env(safe-area-inset-bottom))]',
            // Phones: the bar sits just above the home indicator, like any
            // messaging app — screen height is too scarce for the desktop gap.
            chatStarted &&
              'pointer-coarse:pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.25rem))]',
          )}
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
          {/* Where this conversation goes, right under where it's typed. Part
              of the composer block, so it travels with the bar from home to
              chat and stays beneath it. */}
          {!isSaveStatusOmitted(library.status) && (
            <div className="mt-2.5 flex h-8 justify-center">
              <SaveStatus
                status={library.status}
                folderName={library.folderName}
                chatStarted={chatStarted}
                onChooseFolder={() => library.chooseFolder()}
                onReconnect={library.reconnect}
                onOpenHistory={() => toggleHistory(true)}
              />
            </div>
          )}
        </motion.div>

        {/* Mirrors the spacer above the hero, a little taller, so the hero and
            composer sit at the optical centre — just above the true middle.
            It carries the home screen's fine print, which leaves with the hero
            (popLayout, so the composer's glide isn't disturbed). */}
        <AnimatePresence mode="popLayout" initial={false}>
          {!chatStarted && (
            <motion.div
              key="home-note"
              // The fine print rests at the foot of the screen, on the same
              // 28px margin the composer keeps in a chat.
              className="flex flex-[1.4_1_0] flex-col justify-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.4, ease: EASE_OUT, delay: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_IN } }}
            >
              <HomeNote status={library.status} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export default App
