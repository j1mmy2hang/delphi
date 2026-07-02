// Strips reasoning/thinking blocks and inline tags (e.g. <situation N>) from a
// streaming response. Handles unclosed blocks (still streaming) by matching to end-of-string.
const THINK_BLOCK = /<(think|thinking|reasoning|reflection|analysis|scratchpad)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi

export const stripAngleTags = (text: string): string =>
  text
    .replace(THINK_BLOCK, '')
    .replace(/<[^>]*>/g, '')   // standalone tags like <situation 1>
    .replace(/<[^>]*$/, '')    // partial tag still arriving
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Bold / italic on an already-escaped string. XSS-safe: tags are only introduced
// after escaping, and never span a paragraph break.
const inlineFormat = (s: string): string =>
  s
    .replace(/\*\*((?:(?!\n\n)[\s\S])+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*((?:(?!\n\n)[\s\S])+?)\*/g, '<em>$1</em>')
    .replace(/(?<=^|\W)_((?:(?!\n\n)[\s\S])+?)_(?=$|\W)/g, '<em>$1</em>')

/**
 * Render text into paragraph HTML: blank lines become separate <p> blocks, and
 * single newlines become <br> within a paragraph. `markdown` additionally
 * expands bold/italic (for assistant replies; off for raw user text).
 */
export const renderParagraphs = (text: string, markdown = false): string =>
  escapeHtml(text)
    .split(/\n{2,}/)
    .map(block => block.replace(/^\n+|\n+$/g, ''))
    .filter(block => block.length > 0)
    .map(block => `<p>${(markdown ? inlineFormat(block) : block).replace(/\n/g, '<br>')}</p>`)
    .join('')
