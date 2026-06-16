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
  reset: () => void
}

/**
 * Sequences one message at a time through the wave:
 *   send → rising → thinking → (reply ready) → dissolving → forming → settled
 * The reply is revealed only once it has fully streamed, emerging from the cloud
 * the user's question dissolved into.
 */
export const useConversationStage = (): Conversation => {
  const { messages, isStreaming, send, reset: resetStream } = useChatStream()
  const [stage, setStage] = useState<Stage>({ phase: 'idle', role: 'idle', text: '' })

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const userText = useRef('')
  const thinkStart = useRef(0)
  const wasStreaming = useRef(false)
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

  // Reveal the reply only after it has fully arrived, honouring a minimum
  // thinking beat so the wave always churns for a moment.
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      const reply = messages[messages.length - 1]
      if (reply?.role === 'assistant') {
        const wait = Math.max(0, ms(STAGE.MIN_THINK) - (Date.now() - thinkStart.current))
        const answer = reply.content
        timers.current.push(
          setTimeout(() => {
            setStage({ phase: 'dissolving', role: 'user', text: userText.current })
            after(STAGE.DISSOLVE, () => {
              setStage({ phase: 'forming', role: 'assistant', text: answer })
              after(STAGE.FORM, () =>
                setStage({ phase: 'settled', role: 'assistant', text: answer }),
              )
            })
          }, wait),
        )
      }
    }
    wasStreaming.current = isStreaming
  }, [isStreaming, messages])

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      clearTimers()

      // Whatever is on screen — wordmark, question, or last reply — dissolves
      // into the wave first, then the new question rises out of it.
      const prev = stageRef.current
      setStage({ phase: 'dissolving', role: prev.role, text: prev.text })
      after(STAGE.DISSOLVE, () => {
        userText.current = trimmed
        thinkStart.current = Date.now()
        setStage({ phase: 'rising', role: 'user', text: trimmed })
        after(STAGE.RISE, () => setStage({ phase: 'thinking', role: 'user', text: trimmed }))
        send(trimmed)
      })
    },
    [send],
  )

  const reset = useCallback(() => {
    clearTimers()
    resetStream()
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
    busy: isStreaming || stage.phase === 'dissolving' || stage.phase === 'forming',
    submit,
    reset,
  }
}
