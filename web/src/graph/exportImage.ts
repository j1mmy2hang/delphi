/**
 * The map as a card to keep: its title, the rings, and the line from where the
 * conversation began to where it arrived. Drawn from the live SVG, with every
 * themed colour resolved, so the card matches what's on screen.
 */

const STYLE_PROPS = [
  'fill',
  'stroke',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'stop-color',
  'stop-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-decoration',
] as const

/** CSS variables don't survive into an image; write the computed values in. */
const resolveStyles = (from: Element, to: Element) => {
  const source = [from, ...from.querySelectorAll('*')]
  const target = [to, ...to.querySelectorAll('*')]
  source.forEach((el, i) => {
    const computed = getComputedStyle(el)
    const out = target[i] as SVGElement
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop)
      if (value) out.style.setProperty(prop, value)
    }
  })
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export interface CardText {
  title: string
  /** e.g. ["晚上一直刷视频", "省下重新启动的力气"]; or a question still open. */
  from: string
  to: string
  open: string
}

export const saveMapCard = async (svg: SVGSVGElement, text: CardText) => {
  const { width, height } = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  resolveStyles(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // On screen it fills the panel; as an image it needs its size spelled out.
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const markup = new XMLSerializer().serializeToString(clone)
  const map = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)

  const pad = 44
  const head = 96
  const foot = 92
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = (width + pad * 2) * scale
  canvas.height = (height + head + foot) * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  const bg = token('--background')
  const ink = token('--foreground')
  const muted = token('--muted-foreground')
  const gold = token('--map-core')
  const serif = token('--font-serif') || 'Georgia, serif'
  const sans = getComputedStyle(document.body).fontFamily
  const cardWidth = width + pad * 2

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cardWidth, height + head + foot)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ink
  ctx.font = `26px ${serif}`
  ctx.fillText(text.title || 'Thought map', pad, 56, cardWidth - pad * 2)
  ctx.fillStyle = muted
  ctx.font = `12px ${sans}`
  ctx.fillText(
    new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    pad,
    78,
  )

  ctx.drawImage(map, pad, head, width, height)

  const y = head + height + 46
  ctx.font = `15px ${sans}`
  if (text.from && text.to) {
    // From the surface to the centre: the shape of the conversation in a line.
    ctx.fillStyle = muted
    ctx.fillText(text.from, pad, y)
    let x = pad + ctx.measureText(text.from).width
    ctx.fillText('  →  ', x, y)
    x += ctx.measureText('  →  ').width
    ctx.fillStyle = gold
    ctx.font = `600 15px ${sans}`
    ctx.fillText(text.to, x, y)
  } else if (text.open) {
    ctx.fillStyle = muted
    ctx.font = `italic 15px ${serif}`
    ctx.fillText(text.open, pad, y)
  }
  ctx.fillStyle = muted
  ctx.font = `12px ${sans}`
  ctx.textAlign = 'right'
  ctx.fillText('Delphi', cardWidth - pad, y)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(text.title || 'thought-map').replace(/[\\/:*?"<>|]/g, '')}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
