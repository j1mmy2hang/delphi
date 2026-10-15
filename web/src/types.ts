import type { Failure } from './chat/failures'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  /**
   * Why this reply stopped, shown as a notice under whatever text arrived.
   * UI only: never sent to the model, never saved.
   */
  error?: Failure
}

/** A saved conversation, as stored in one Markdown file. */
export interface Conversation {
  id: string
  title: string
  /** ISO 8601 with the local offset, e.g. 2026-10-13T15:42:10+08:00 */
  created: string
  updated: string
  /** When Delphi closed it (its situation 4 reply); absent while it's open. */
  closed?: string
  messages: Message[]
}
