import { useRef, useState } from 'react'
import { WaveField } from './components/WaveField'
import { MessageStage } from './components/MessageStage'
import { InputDock } from './components/InputDock'
import { useConversationStage } from './hooks/useConversationStage'
import { useViewportKeyboard } from './hooks/useViewportKeyboard'

function App() {
  const [input, setInput] = useState('')
  const { phase, role, text, intensity, busy, submit, reset } = useConversationStage()
  const started = !(role === 'idle' && phase === 'idle')

  const dockRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useViewportKeyboard(started, textareaRef, dockRef)

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setInput('')
    submit(trimmed)
  }

  const handleNewChat = () => {
    reset()
    setInput('')
  }

  return (
    <div className="app">
      <WaveField intensity={intensity} />

      <main className="stage-wrap">
        <MessageStage role={role} text={text} phase={phase} />
      </main>

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
