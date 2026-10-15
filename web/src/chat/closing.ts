/**
 * Delphi ends a conversation with its situation 4 reply: a final summary and
 * goodbye, after which the user can't write again. The reply carries a hidden
 * signal — it opens with `<situation 4>` and ends with `<end>` — and either
 * one closes the conversation, in case the model drops the other. Both are
 * stripped from what's shown. The chat function checks the same signal, so a
 * closed conversation stays closed (netlify/functions/chat.mts).
 */
const CLOSING = /<\s*(?:end|situation\s*4)\s*\/?>/i

export const isClosing = (content: string) => CLOSING.test(content)

/** The index of the reply that closed the conversation, or -1. */
export const closingIndex = (messages: { role: string; content: string }[]) =>
  messages.findIndex((m) => m.role === 'assistant' && isClosing(m.content))
