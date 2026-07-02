import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStream } from './useChatStream'
import { STAGE, WAVE_INTENSITY } from '../constants'
import type { Phase } from '../components/MessageStage'

const ms = (s: number) => s * 1000

interface Stage {
  phase: Phase
  role: 'idle' | 'user' | 'assistant'
  text: string
}

export interface Conversation {
  phase: Phase
  role: Stage['role']
  text: string
  intensity: number
  busy: boolean
  submit: (text: string) => void
  arrive: () => void
  reset: () => void
}

/**
 * One message on screen at a time, choreographed for continuity:
 *   submit  → old content melts into the wave while the typed words ascend
 *   arrive  → the words land at centre and rest (the oracle thinks)
 *   reveal  → once the reply is ready (and the words have rested a beat) they
 *             dissolve into the cloud and the reply forms back out of it.
 * The ascent itself is the AscendingMessage overlay in App; this hook owns the
 * stage state and timing, and `arrive()` is the hand-off from that overlay.
 */
export const useConversationStage = (): Conversation => {
  const { messages, isStreaming, send, reset: resetStream } = useChatStream()
  const [stage, setStage] = useState<Stage>({ phase: 'idle', role: 'idle', text: '' })

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const userText = useRef('')
  const restStart = useRef(0) // when the user's words landed at centre
  const wasStreaming = useRef(false)
  const pendingReply = useRef<string | null>(null)
  const revealing = useRef(false)
  const stageRef = useRef(stage)
  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const after = (s: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms(s)))
  }

  // Dissolve the rested question into the cloud and form the reply out of it.
  const reveal = useCallback(() => {
    if (revealing.current) return
    if (stageRef.current.phase !== 'thinking') return // words haven't landed yet
    if (pendingReply.current == null) return // reply not ready yet
    revealing.current = true
    const answer = pendingReply.current
    pendingReply.current = null
    const wait = Math.max(0, ms(STAGE.MIN_THINK) - (Date.now() - restStart.current))
    timers.current.push(
      setTimeout(() => {
        setStage({ phase: 'dissolving', role: 'user', text: userText.current })
        after(STAGE.DISSOLVE, () => {
          setStage({ phase: 'forming', role: 'assistant', text: answer })
          after(STAGE.FORM, () => {
            setStage({ phase: 'settled', role: 'assistant', text: answer })
            revealing.current = false
          })
        })
      }, wait),
    )
  }, [])

  // Stream finished → stash the reply and try to reveal it.
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      const reply = messages[messages.length - 1]
      if (reply?.role === 'assistant') {
        pendingReply.current = reply.content
        reveal()
      }
    }
    wasStreaming.current = isStreaming
  }, [isStreaming, messages, reveal])

  // The words just landed → the reply may already be waiting.
  useEffect(() => {
    if (stage.phase === 'thinking') reveal()
  }, [stage.phase, reveal])

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      clearTimers()
      revealing.current = false
      pendingReply.current = null
      userText.current = trimmed
      // Whatever is on screen melts into the wave while the words ascend.
      const prev = stageRef.current
      setStage({ phase: 'dissolving', role: prev.role, text: prev.text })
      send(trimmed)
    },
    [send],
  )

  // Called by the ascending overlay when the words reach the centre.
  const arrive = useCallback(() => {
    restStart.current = Date.now()
    setStage({ phase: 'thinking', role: 'user', text: userText.current })
  }, [])

  const reset = useCallback(() => {
    clearTimers()
    resetStream()
    revealing.current = false
    pendingReply.current = null
    const prev = stageRef.current
    if (prev.role === 'idle' && prev.phase === 'idle') return
    setStage({ phase: 'dissolving', role: prev.role, text: prev.text })
    after(STAGE.DISSOLVE, () => setStage({ phase: 'idle', role: 'idle', text: '' }))
  }, [resetStream])

  useEffect(() => clearTimers, [])

  const intensity = WAVE_INTENSITY[stage.phase] ?? 0.2

  return {
    phase: stage.phase,
    role: stage.role,
    text: stage.text,
    intensity,
    // A turn is in progress from send until the reply has fully settled.
    busy:
      isStreaming ||
      stage.phase === 'dissolving' ||
      stage.phase === 'forming' ||
      stage.phase === 'thinking',
    submit,
    arrive,
    reset,
  }
}
