import { useEffect, useState } from 'react'

/**
 * Liquid-glass refraction, following kube.io's pipeline:
 *
 *  1. Surface — the bezel cross-section is a convex squircle height profile
 *       f(x) = (1 - (1 - x)^4)^(1/4),  x in [0,1]  (0 = outer edge, 1 = inner flat)
 *  2. Snell — the numeric slope f'(x) is the angle of incidence; refract air→glass
 *       (n 1 → 1.5) and the lateral bend ≈ tan(θ1 - θ2) is the displacement at that
 *       distance from the border. It's symmetric around a capsule's border, so we
 *       solve it once as a 1D radial profile and reuse it.
 *  3. Map — encode the vector field as RGBA (R = 128 + x·127, G = 128 + y·127),
 *       128 being "no shift". feDisplacementMap then pushes the live backdrop.
 *
 * The map depends only on geometry (size + radius); the four sliders are live
 * filter attributes and never rebuild it.
 */

export interface GlassParams {
  refraction: number // feDisplacementMap scale
  blur: number // feGaussianBlur stdDeviation
  saturation: number // feColorMatrix saturate
  specular: number // rim-highlight opacity
}

export const GLASS_DEFAULTS: GlassParams = {
  refraction: 140,
  blur: 5,
  saturation: 1,
  specular: 0.05,
}

const IOR = 1 / 1.5 // n_air / n_glass
const surface = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 0.25)

// 1D displacement magnitude vs. distance-from-border (normalised to its peak).
const buildProfile = (bezel: number) => {
  const N = Math.max(8, Math.ceil(bezel))
  const profile = new Float64Array(N + 1)
  let peak = 1e-6
  for (let i = 0; i <= N; i++) {
    const x = i / N
    const h = 1e-3
    const a = Math.min(Math.max(x, h), 1 - h)
    const slope = (surface(a + h) - surface(a - h)) / (2 * h)
    const theta1 = Math.atan(slope)
    const theta2 = Math.asin(Math.max(-1, Math.min(1, Math.sin(theta1) * IOR)))
    const d = Math.tan(theta1 - theta2)
    profile[i] = d
    if (d > peak) peak = d
  }
  for (let i = 0; i <= N; i++) profile[i] /= peak
  return { profile, N }
}

const makeDisplacementMap = (W: number, H: number, radius: number, bezel: number): string => {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const data = img.data

  const hw = W / 2
  const hh = H / 2
  const r = Math.min(radius, hw, hh)
  const { profile, N } = buildProfile(bezel)

  // Signed distance to a rounded rectangle (capsule when r = min half-extent).
  const sdf = (x: number, y: number) => {
    const qx = Math.abs(x - hw) - (hw - r)
    const qy = Math.abs(y - hh) - (hh - r)
    const ax = Math.max(qx, 0)
    const ay = Math.max(qy, 0)
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const d = sdf(px, py)
      const inside = -d
      let vx = 0
      let vy = 0
      if (d < 0 && inside < bezel) {
        // outward normal = gradient of the SDF
        const gx = sdf(px + 1, py) - sdf(px - 1, py)
        const gy = sdf(px, py + 1) - sdf(px, py - 1)
        const gl = Math.hypot(gx, gy) || 1
        const mag = profile[Math.min(N, Math.round((inside / bezel) * N))]
        // displace inward (−normal) so the edge magnifies the backdrop like a lens
        vx = (-gx / gl) * mag
        vy = (-gy / gl) * mag
      }
      const i = (y * W + x) * 4
      data[i] = 128 + vx * 127
      data[i + 1] = 128 + vy * 127
      data[i + 2] = 128
      data[i + 3] = 255
    }
  }

  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

interface Props {
  id: string
  width: number
  height: number
  radius: number
  bezel: number
  refraction: number // → feDisplacementMap scale
  blur: number // → feGaussianBlur stdDeviation
  saturation: number // → feColorMatrix saturate
}

export const LiquidGlassFilter = ({
  id, width, height, radius, bezel, refraction, blur, saturation,
}: Props) => {
  const [map, setMap] = useState('')
  const W = Math.max(1, Math.round(width))
  const H = Math.max(1, Math.round(height))

  // Rebuild the map only when geometry changes — never on a slider tick.
  useEffect(() => {
    if (W < 4 || H < 4) return
    setMap(makeDisplacementMap(W, H, radius, bezel))
  }, [W, H, radius, bezel])

  if (!map) return null

  return (
    <svg className="lg-defs" width="0" height="0" aria-hidden="true">
      <filter
        id={id}
        x="-30%"
        y="-30%"
        width="160%"
        height="160%"
        colorInterpolationFilters="sRGB"
        primitiveUnits="userSpaceOnUse"
      >
        <feImage href={map} x={0} y={0} width={W} height={H} preserveAspectRatio="none" result="map" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="map"
          scale={refraction}
          xChannelSelector="R"
          yChannelSelector="G"
          result="disp"
        />
        <feGaussianBlur in="disp" stdDeviation={blur} result="blur" />
        <feColorMatrix in="blur" type="saturate" values={String(saturation)} />
      </filter>
    </svg>
  )
}
