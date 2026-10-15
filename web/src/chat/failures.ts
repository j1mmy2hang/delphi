/**
 * Everything that can stop a reply, in words a person can act on. The server
 * sends a stable `code` with each error (see netlify/functions/chat.mts); the
 * client owns the wording, so it can mention local times and next steps.
 */

export type FailureCode =
  // Client-side
  | 'network' // the request never reached the server
  | 'interrupted' // the reply started, then the stream broke
  // From the server
  | 'rate_limited'
  | 'daily_limit'
  | 'monthly_limit'
  | 'message_too_long'
  | 'conversation_too_long'
  | 'conversation_closed'
  | 'unauthorized'
  | 'unavailable'
  | 'upstream_error'
  | 'invalid_request'
  | 'unknown'

/** What the notice offers: send again, or start over in a fresh chat. */
export type FailureAction = 'retry' | 'new-chat'

export interface Failure {
  code: FailureCode
  message: string
  action?: FailureAction
}

/** Thrown inside the stream reader to carry a described failure out. */
export class FailureError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message)
  }
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' })

/**
 * "at 8:00 PM", "tomorrow at 8:00 AM", or "on October 31 at 8:00 PM", in the
 * reader's time zone. Always with the time: the server resets at midnight UTC,
 * which in most places isn't midnight — "November 1" alone would be wrong by
 * hours for anyone west of Greenwich.
 */
const describeReset = (epochSeconds: number | undefined, fallback: string) => {
  if (!epochSeconds) return fallback
  const at = new Date(epochSeconds * 1000)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (at.toDateString() === today.toDateString()) return `at ${timeFormat.format(at)}`
  if (at.toDateString() === tomorrow.toDateString()) return `tomorrow at ${timeFormat.format(at)}`
  return `on ${dateFormat.format(at)} at ${timeFormat.format(at)}`
}

const seconds = (n: number | undefined) =>
  !n || n <= 1 ? 'a moment' : n < 60 ? `${Math.ceil(n)} seconds` : 'a minute'

export const describe = (
  code: FailureCode,
  details: { resetAt?: number; retryAfter?: number } = {},
): Failure => {
  switch (code) {
    case 'network':
      return {
        code,
        message: "Couldn't reach Delphi. Check your internet connection and try again.",
        action: 'retry',
      }
    case 'interrupted':
      return {
        code,
        message: 'The reply was interrupted before it finished. Try again for a complete answer.',
        action: 'retry',
      }
    case 'rate_limited':
      return {
        code,
        message: `You're sending messages faster than Delphi allows. Wait ${seconds(details.retryAfter)} and try again.`,
        action: 'retry',
      }
    case 'daily_limit':
      return {
        code,
        message: `You've used today's free allowance. It resets ${describeReset(details.resetAt, 'tomorrow')}.`,
      }
    case 'monthly_limit':
      return {
        code,
        message: `You've used this month's allowance. It resets ${describeReset(details.resetAt, 'next month')}.`,
      }
    case 'message_too_long':
      return {
        code,
        message: 'That message is too long for Delphi to read. Try shortening it or sending it in parts.',
      }
    case 'conversation_too_long':
      return {
        code,
        message: 'This conversation has reached its length limit. Start a new chat to keep going.',
        action: 'new-chat',
      }
    case 'conversation_closed':
      return {
        code,
        message: 'This conversation has come to a close. Start a new one to keep talking.',
        action: 'new-chat',
      }
    case 'unauthorized':
      return {
        code,
        message: "Delphi couldn't verify this request. Refresh the page and try again.",
      }
    case 'unavailable':
      return {
        code,
        message: 'Delphi is temporarily unavailable. Please try again later.',
        action: 'retry',
      }
    case 'upstream_error':
      return {
        code,
        message: "The AI service behind Delphi isn't responding right now. Try again in a moment.",
        action: 'retry',
      }
    case 'invalid_request':
      return {
        code,
        message: "Delphi couldn't read that request. Refresh the page and try again.",
      }
    default:
      return { code: 'unknown', message: 'Something went wrong. Please try again.', action: 'retry' }
  }
}

const SERVER_CODES = new Set<FailureCode>([
  'rate_limited',
  'daily_limit',
  'monthly_limit',
  'message_too_long',
  'conversation_too_long',
  'conversation_closed',
  'unauthorized',
  'unavailable',
  'upstream_error',
  'invalid_request',
])

/** Reads a non-2xx response from the chat function. */
export const failureFromResponse = async (res: Response): Promise<Failure> => {
  let body: { code?: string; error?: string; resetAt?: number; retryAfter?: number } = {}
  try {
    body = await res.json()
  } catch {
    // Not JSON (a proxy's error page, say): fall back on the status.
  }
  const retryAfter = body.retryAfter ?? (Number(res.headers.get('Retry-After')) || undefined)

  if (body.code && SERVER_CODES.has(body.code as FailureCode)) {
    return describe(body.code as FailureCode, { resetAt: body.resetAt, retryAfter })
  }
  // An older deployment without codes: the monthly limit was the only 429 body.
  if (body.error === 'limit') return describe('monthly_limit', { resetAt: body.resetAt })
  if (res.status === 429) return describe('rate_limited', { retryAfter })
  if (res.status === 401 || res.status === 403) return describe('unauthorized')
  if (res.status >= 500) return describe('upstream_error')
  return describe('unknown')
}
