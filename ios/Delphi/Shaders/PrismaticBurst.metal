#include <metal_stdlib>
using namespace metal;

// -----------------------------------------------------------------------------
// Attribution: this prismatic burst is a Metal port derived from ReactBits'
// "PrismaticBurst" background — react-bits © 2026 David Haz, licensed MIT +
// Commons Clause License Condition v1.0. Using it to build this app is permitted;
// the components themselves are not resold. Full notice: ACKNOWLEDGMENTS.md.
// -----------------------------------------------------------------------------

// Ray-march iteration count — the dominant per-pixel cost knob. The far steps
// are attenuated to ~zero by smoothstep(5,0,rad) and edgeFade, so trimming from
// the original 44 is nearly invisible but meaningfully cheaper.
#define MARCH_STEPS 40

// =============================================================================
// Prismatic ray-march burst — Metal port of the web app's GLSL fragment shader
// (after ReactBits' PrismaticBurst). The web canvas was screen-blended over a
// deep radial gradient; here both the gradient and the screen blend are baked
// into the shader so a single opaque pass renders the finished stage.
//
// Animation SPEED, BRIGHTNESS and DISTORTION are eased on the CPU (see
// PrismaticBurstView) and fed in as uniforms, so phase changes glide.
// =============================================================================

struct Uniforms {
    float2 resolution;
    float  time;
    float  intensity;
    float  speed;
    float  distort;
    float2 offset;
    float  noiseAmount;
    int    colorCount;
    int    rayCount;
};

// ---- helpers ---------------------------------------------------------------

// GLSL-style mod (floored), which differs from fmod for negative inputs.
static inline float2 modf2(float2 x, float y) { return x - y * floor(x / y); }

static inline float hash21(float2 p) {
    p = floor(p);
    float f = 52.9829189 * fract(dot(p, float2(0.065, 0.005)));
    return fract(f);
}

static inline float2x2 rot30() { return float2x2(0.8, -0.5, 0.5, 0.8); }

static inline float layeredNoise(float2 fragPx, float time) {
    float2 p = modf2(fragPx + float2(time * 30.0, -time * 21.0), 1024.0);
    float2 q = rot30() * p;
    float n = 0.0;
    n += 0.40 * hash21(q);
    n += 0.25 * hash21(q * 2.0 + 17.0);
    n += 0.20 * hash21(q * 4.0 + 47.0);
    n += 0.10 * hash21(q * 8.0 + 113.0);
    n += 0.05 * hash21(q * 16.0 + 191.0);
    return n;
}

static inline float3 rayDir(float2 frag, float2 res, float2 offset, float dist) {
    float focal = res.y * max(dist, 1e-3);
    return normalize(float3(2.0 * (frag - offset) - res, focal));
}

static inline float edgeFade(float2 frag, float2 res, float2 offset, float time) {
    float2 toC = frag - 0.5 * res - offset;
    float r = length(toC) / (0.5 * min(res.x, res.y));
    float x = clamp(r, 0.0, 1.0);
    float q = x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
    float s = q * 0.5;
    s = pow(s, 1.5);
    float tail = 1.0 - pow(1.0 - s, 2.0);
    s = mix(s, tail, 0.2);
    float dn = (layeredNoise(frag * 0.15, time) - 0.5) * 0.0015 * s;
    return clamp(s + dn, 0.0, 1.0);
}

static inline float3x3 rotX(float a) { float c = cos(a), s = sin(a); return float3x3(1.,0.,0., 0.,c,-s, 0.,s,c); }
static inline float3x3 rotY(float a) { float c = cos(a), s = sin(a); return float3x3(c,0.,s, 0.,1.,0., -s,0.,c); }
static inline float3x3 rotZ(float a) { float c = cos(a), s = sin(a); return float3x3(c,-s,0., s,c,0., 0.,0.,1.); }

// Linear-interpolated lookup across the palette — matches the web's LINEAR,
// CLAMP_TO_EDGE 1D gradient texture.
static inline float3 sampleGradient(float t, constant float4 *colors, int count) {
    t = clamp(t, 0.0, 1.0);
    if (count <= 1) return colors[0].rgb;
    float fpos = t * float(count - 1);
    int i0 = int(floor(fpos));
    int i1 = min(i0 + 1, count - 1);
    float f = fract(fpos);
    return mix(colors[i0].rgb, colors[i1].rgb, f);
}

static inline float2 rot2(float2 v, float a) { float s = sin(a), c = cos(a); return float2x2(c,-s,s,c) * v; }

static inline float bendAngle(float3 q, float t) {
    return 0.8 * sin(q.x * 0.55 + t * 0.6)
         + 0.7 * sin(q.y * 0.50 - t * 0.5)
         + 0.6 * sin(q.z * 0.60 + t * 0.7);
}

// ---- vertex: full-screen triangle ------------------------------------------

struct RasterData {
    float4 position [[position]];
};

vertex RasterData burst_vertex(uint vid [[vertex_id]]) {
    float2 pos[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
    RasterData out;
    out.position = float4(pos[vid], 0.0, 1.0);
    return out;
}

// ---- fragment --------------------------------------------------------------

fragment float4 burst_fragment(float4 fragCoord [[position]],
                               constant Uniforms &u   [[buffer(0)]],
                               constant float4   *colors [[buffer(1)]]) {
    float2 res = u.resolution;

    // Metal's framebuffer origin is top-left; the GLSL original assumed
    // bottom-left. Flip Y so the burst reads identically.
    float2 frag = float2(fragCoord.x, res.y - fragCoord.y);

    float t = u.time * u.speed;
    float jitterAmp = 0.1 * clamp(u.noiseAmount, 0.0, 1.0);
    float3 dir = rayDir(frag, res, u.offset, 1.0);
    float marchT = 0.0;
    float3 col = float3(0.0);
    float n = layeredNoise(frag, u.time);
    float amp = clamp(u.distort, 0.0, 50.0) * 0.15;

    float3 ang = float3(t * 0.31, t * 0.21, t * 0.17);
    float3x3 rot3dMat = rotZ(ang.z) * rotY(ang.y) * rotX(ang.x);

    for (int i = 0; i < MARCH_STEPS; ++i) {
        float3 P = marchT * dir;
        P.z -= 2.0;
        float rad = length(P);
        float3 Pl = P * (10.0 / max(rad, 1e-6));
        Pl = rot3dMat * Pl;

        float stepLen = min(rad - 0.3, n * jitterAmp) + 0.1;

        float grow = smoothstep(0.35, 3.0, marchT);
        float a1 = amp * grow * bendAngle(Pl * 0.6, t);
        float a2 = 0.5 * amp * grow * bendAngle(Pl.zyx * 0.5 + 3.1, t * 0.9);
        float3 Pb = Pl;
        Pb.xz = rot2(Pb.xz, a1);
        Pb.xy = rot2(Pb.xy, a2);

        float rayPattern = smoothstep(
            0.5, 0.7,
            sin(Pb.x + cos(Pb.y) * cos(Pb.z)) *
            sin(Pb.z + sin(Pb.y) * cos(Pb.x + t)));

        if (u.rayCount > 0) {
            float a = atan2(Pb.y, Pb.x);
            float comb = 0.5 + 0.5 * cos(float(u.rayCount) * a);
            comb = pow(comb, 3.0);
            rayPattern *= smoothstep(0.15, 0.95, comb);
        }

        float3 spectralDefault = 1.0 + float3(
            cos(marchT * 3.0 + 0.0),
            cos(marchT * 3.0 + 1.0),
            cos(marchT * 3.0 + 2.0));
        float saw = fract(marchT * 0.25);
        float tRay = saw * saw * (3.0 - 2.0 * saw);
        float3 userGradient = 2.0 * sampleGradient(tRay, colors, u.colorCount);
        float3 spectral = (u.colorCount > 0) ? userGradient : spectralDefault;
        float3 base = (0.05 / (0.4 + stepLen)) * smoothstep(5.0, 0.0, rad) * spectral;

        col += base * rayPattern;
        marchT += stepLen;
    }

    col *= edgeFade(frag, res, u.offset, u.time);
    col *= u.intensity;
    col = clamp(col, 0.0, 1.0);

    // Deep radial background gradient (matches the web's .app stage), then a
    // screen blend so dark rays show the gradient and bright rays glow.
    float2 uv = fragCoord.xy / res; // top-left origin, like the CSS box
    float2 d = (uv - float2(0.5, 0.18)) / float2(1.3, 0.95);
    float rt = clamp(length(d), 0.0, 1.0);
    float3 bg0 = float3(0.039, 0.039, 0.071); // #0A0A12
    float3 bg1 = float3(0.020, 0.020, 0.035); // #050509
    float3 bg = mix(bg0, bg1, rt);

    float3 outc = 1.0 - (1.0 - bg) * (1.0 - col); // screen
    return float4(outc, 1.0);
}
