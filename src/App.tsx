import { useRef, useState } from 'react'
import { PrismaticBurst } from './components/PrismaticBurst'
import { MessageStage } from './components/MessageStage'
import { AscendingMessage } from './components/AscendingMessage'
import { InputDock } from './components/InputDock'
import { useConversationStage } from './hooks/useConversationStage'
import { useViewportKeyboard } from './hooks/useViewportKeyboard'

// Resting centre of the stage as a fraction of viewport height — must match the
// .stage-wrap padding (top 19vh / bottom 15vh → centre at 0.52).
const STAGE_CENTER = 0.52
// Roughly input font (16px) over resting serif (~26px) so the words start
// input-sized and grow as they rise.
const START_SCALE = 0.62

interface Flight {
  id: number
  text: string
  startY: number
  scale: number
}

function App() {
  const [input, setInput] = useState('')
  const [flight, setFlight] = useState<Flight | null>(null)
  const flightId = useRef(0)
  const { phase, role, text, intensity, busy, submit, arrive, reset } = useConversationStage()
  const started = !(role === 'idle' && phase === 'idle')

  const dockRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useViewportKeyboard(started, textareaRef, dockRef)

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setInput('')

    // Launch the words from the input's current position up to the centre.
    const rect = textareaRef.current?.getBoundingClientRect()
    const startY = rect
      ? rect.top + rect.height / 2 - window.innerHeight * STAGE_CENTER
      : window.innerHeight * 0.4
    setFlight({ id: ++flightId.current, text: trimmed, startY, scale: START_SCALE })
    submit(trimmed)
  }

  const handleArrived = () => {
    arrive()
    setFlight(null)
  }

  const handleNewChat = () => {
    reset()
    setFlight(null)
    setInput('')
  }

  return (
    <div className="app">
      <PrismaticBurst intensity={intensity} />
      <div className="stage-scrim" aria-hidden="true" />

      <main className="stage-wrap">
        <MessageStage role={role} text={text} phase={phase} />
      </main>

      {flight && (
        <AscendingMessage
          key={flight.id}
          text={flight.text}
          startY={flight.startY}
          startScale={flight.scale}
          onArrived={handleArrived}
        />
      )}

      <InputDock
        ref={dockRef}
        textareaRef={textareaRef}
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onNewChat={handleNewChat}
        started={started}
        disabled={busy}
      />
    </div>
  )
}

export default App
