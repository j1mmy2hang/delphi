import { useEffect, useRef } from 'react'

/**
 * The centerpiece: a full-screen, perpetually flowing wave of light that
 * symbolises thought. Rendered as a single fullscreen WebGL quad running a
 * domain-warped fractal-noise field. `intensity` (0 calm … 1 churning) is eased
 * internally so phase changes feel like the wave gathering and releasing energy.
 *
 * Falls back to a soft CSS aurora (see .wave-fallback) if WebGL is unavailable.
 */

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_intensity;
uniform float u_dark;

// --- value noise / fbm --------------------------------------------------------
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p  = uv - 0.5;
  p.x *= u_res.x / u_res.y;

  float it = u_intensity;
  // Gentle throughout — even at full "thinking" the flow only quickens a little.
  float t  = u_time * (0.035 + 0.05 * it);

  // domain warp — the flow
  vec2 q = vec2(
    fbm(p * 1.55 + vec2(0.0, t)),
    fbm(p * 1.55 + vec2(5.2, -t * 0.8))
  );
  float f = fbm(p * 2.1 + q * (0.85 + 0.35 * it) + vec2(t * 0.5, t * 0.18));

  // layered contour lines flowing through the field
  float lines = abs(sin((f * 6.0 + uv.x * 2.2 - t * 1.6) * 3.14159));
  lines = pow(1.0 - lines, 7.0);

  // central horizontal envelope — the wave swells a touch taller as it thinks
  float spread = 0.27 + 0.13 * it;
  float env = exp(-pow((uv.y - 0.5) / spread, 2.0) * 0.95);

  float glow = smoothstep(0.18, 0.92, f);

  vec3 colA = mix(vec3(0.09, 0.13, 0.30), vec3(0.07, 0.10, 0.26), u_dark);
  vec3 colB = mix(vec3(0.27, 0.35, 0.62), vec3(0.40, 0.48, 0.94), u_dark);
  vec3 colC = mix(vec3(0.58, 0.66, 0.90), vec3(0.78, 0.83, 1.00), u_dark);

  vec3 col = mix(colA, colB, glow);
  col = mix(col, colC, lines * (0.45 + 0.55 * it) * env);

  float alpha = env * (0.27 + 0.32 * it) * (0.45 + 0.6 * glow);
  alpha += lines * env * (0.2 + 0.18 * it);

  // faint drifting motes for depth
  float spark = noise(uv * (u_res.xy * 0.5) + t * 8.0);
  alpha += smoothstep(0.987, 1.0, spark) * env * 0.4 * (0.35 + 0.6 * it);

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`

const VERT = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`

interface Props {
  intensity: number
}

export const WaveField = ({ intensity }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRef = useRef(intensity)
  targetRef.current = intensity

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
    if (!gl) {
      canvas.classList.add('wave-canvas-hidden')
      return
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      return sh
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(program)
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    const uRes = gl.getUniformLocation(program, 'u_res')
    const uTime = gl.getUniformLocation(program, 'u_time')
    const uIntensity = gl.getUniformLocation(program, 'u_intensity')
    const uDark = gl.getUniformLocation(program, 'u_dark')

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
    const reduceMq = window.matchMedia('(prefers-reduced-motion: reduce)')

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.floor(window.innerWidth * dpr)
      const h = Math.floor(window.innerHeight * dpr)
      if (canvas.width === w && canvas.height === h) return
      canvas.width = w
      canvas.height = h
      gl.viewport(0, 0, w, h)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    let current = targetRef.current
    let last = performance.now()
    const speed = reduceMq.matches ? 0.25 : 1

    const render = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      // ease gently toward the phase's target energy
      current += (targetRef.current - current) * Math.min(dt * 1.6, 1)

      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, (now / 1000) * speed)
      gl.uniform1f(uIntensity, current)
      gl.uniform1f(uDark, darkMq.matches ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else {
        last = performance.now()
        raf = requestAnimationFrame(render)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      gl.deleteProgram(program)
      gl.deleteBuffer(buffer)
    }
  }, [])

  return (
    <div className="wave" aria-hidden="true">
      <div className="wave-fallback" />
      <canvas ref={canvasRef} className="wave-canvas" />
    </div>
  )
}
