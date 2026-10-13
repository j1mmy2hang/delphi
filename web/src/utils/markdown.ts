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
