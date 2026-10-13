/**
 * A random UUID (v4) that works on any page.
 *
 * crypto.randomUUID() only exists in secure contexts — HTTPS or localhost. A
 * phone opening the dev server at http://192.168.x.x:5173 isn't one, so it's
 * undefined there and the first message failed silently. getRandomValues()
 * has no such restriction.
 */
export const newId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
