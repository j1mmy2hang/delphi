import type { Conversation, Message } from '../types'

/**
 * One conversation per Markdown file, readable as a document and parseable
 * back without loss:
 *
 *   ---
 *   id: 6f1c…
 *   title: "How do I think more clearly about a hard decision?"
 *   created: 2026-10-13T15:42:10+08:00
 *   updated: 2026-10-13T15:44:02+08:00
 *   ---
 *
 *   <!-- delphi:user -->
 *   ## You
 *
 *   How do I think more clearly about a hard decision?
 *
 *   <!-- delphi:assistant -->
 *   ## Delphi
 *
 *   …
 *
 * Messages are split on the HTML comments, not the headings: comments don't
 * render, and unlike a "## " line, nobody types one by accident inside a
 * message. The front matter is YAML, so Obsidian and friends read it too.
 */

const LABEL: Record<Message['role'], string> = { user: 'You', assistant: 'Delphi' }
const MARKER = /^<!-- delphi:(user|assistant) -->$/m
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/

export const serialize = (c: Conversation): string => {
  const head = [
    '---',
    `id: ${c.id}`,
    // JSON string syntax is valid YAML and survives quotes and colons.
    `title: ${JSON.stringify(c.title)}`,
    `created: ${c.created}`,
    `updated: ${c.updated}`,
    '---',
  ].join('\n')

  const body = c.messages
    .map((m) => `<!-- delphi:${m.role} -->\n## ${LABEL[m.role]}\n\n${m.content.trim()}`)
    .join('\n\n')

  return `${head}\n\n${body}\n`
}

/** Reads a file written by `serialize`. Returns null for any other Markdown. */
export const parse = (text: string): Conversation | null => {
  const normalized = text.replace(/\r\n/g, '\n')
  const fm = FRONT_MATTER.exec(normalized)
  if (!fm) return null

  const meta = parseFrontMatter(fm[1])
  if (!meta.id) return null

  // split() with a capture group yields [preamble, role, chunk, role, chunk…].
  const parts = normalized.slice(fm[0].length).split(MARKER)
  const messages: Message[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const role = parts[i] as Message['role']
    const content = parts[i + 1]
      .replace(new RegExp(`^\\s*## ${LABEL[role]}[ \\t]*\\n`), '')
      .trim()
    if (content) messages.push({ role, content })
  }

  return {
    id: meta.id,
    title: meta.title || titleFrom(messages),
    created: meta.created ?? '',
    updated: meta.updated ?? meta.created ?? '',
    messages,
  }
}

/** Just the front matter — enough to list a conversation without parsing it. */
export const parseMeta = (text: string) => {
  const fm = FRONT_MATTER.exec(text.replace(/\r\n/g, '\n'))
  return fm ? parseFrontMatter(fm[1]) : {}
}

const parseFrontMatter = (block: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const m = /^(\w+):\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        value = value.slice(1, -1)
      }
    }
    out[m[1]] = value
  }
  return out
}

/** The first thing the user said, cut at a word boundary. */
export const titleFrom = (messages: Message[]): string => {
  const first = messages.find((m) => m.role === 'user')?.content ?? ''
  const oneLine = first.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 60) return oneLine || 'Untitled'
  const cut = oneLine.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** "2026-10-13 How do I think more clearly.md" — safe on macOS, Windows, Linux. */
export const fileNameFor = (c: Conversation, suffix = ''): string => {
  const date = c.created.slice(0, 10)
  const title = c.title
    .replace(/…$/, '')
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trimEnd()
    .replace(/[. ]+$/, '')
  return `${date} ${title || 'Untitled'}${suffix}.md`
}

/** Local time with its offset — readable in the file, and still exact. */
export const localISO = (date = new Date()): string => {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(offset % 60)}`
  )
}
