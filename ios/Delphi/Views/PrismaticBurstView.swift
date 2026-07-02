import SwiftUI
import MetalKit
import simd

/// The thinking surface — a Metal ray-march burst whose energy (speed,
/// brightness, ray distortion) is eased toward a per-phase target so the stage
/// reads at a glance: calm → build → peak → ease → calm.
///
/// This is the native counterpart of the web app's WebGL canvas: Metal is to
/// iOS what WebGL was to the browser. The shader is a heavy per-pixel ray-march
/// and the app is entirely GPU-bound (the CPU just encodes one draw call a
/// frame), so power is managed on the GPU side: it renders at 0.6× resolution
/// (the burst is soft, so the upscale is invisible) and is capped well below the
/// display refresh — 30fps while the choreography moves, 20fps when calm or
/// while the keyboard is up (never 60, never ProMotion's 120), dropping to
/// 10fps after several seconds sitting at the calm baseline with nothing
/// changing on screen. Plus a thermal backoff that halves the rate again under
/// sustained heat. This keeps the GPU from pinning (heat) and the main thread
/// free for responsive typing.
struct PrismaticBurstView: UIViewRepresentable {
    /// Conversation energy, 0 (calm) … 1 (churning).
    var intensity: Double
    /// Pause the render loop when the app isn't active.
    var active: Bool = true
    /// Throttle to 30fps regardless of energy — e.g. while the keyboard is up,
    /// so text input stays snappy instead of fighting the GPU for the main thread.
    var lowPower: Bool = false

    func makeCoordinator() -> Renderer { Renderer() }

    func makeUIView(context: Context) -> BurstMTKView {
        let view = BurstMTKView(frame: .zero, device: context.coordinator.device)
        view.delegate = context.coordinator
        view.colorPixelFormat = .bgra8Unorm
        view.framebufferOnly = true
        view.isOpaque = true
        view.backgroundColor = .black
        view.preferredFramesPerSecond = 30
        view.autoResizeDrawable = false
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.renderScale = 0.6
        context.coordinator.configure()
        return view
    }

    func updateUIView(_ view: BurstMTKView, context: Context) {
        context.coordinator.targetIntensity = Float(intensity)
        view.isPaused = !active
        view.preferredFramesPerSecond = Self.frameRate(intensity: intensity, lowPower: lowPower)
    }

    /// The burst is a soft ambient glow, so it's capped well below the display
    /// refresh — never ProMotion's 120, never even 60: 30fps while the
    /// choreography is actually moving, 20fps when calm or while typing. This
    /// roughly halves the GPU's sustained power versus a 60fps cap. The
    /// foreground text choreography is CoreAnimation-driven and stays smooth at
    /// the display's native rate regardless, so only the background glow is
    /// throttled. (30 and 20 divide both 60Hz and 120Hz panels cleanly.) Real
    /// elapsed time is integrated, so a lower frame rate slows nothing down — it
    /// only spends less power.
    static func frameRate(intensity: Double, lowPower: Bool) -> Int {
        if lowPower { return 20 }
        return intensity >= 0.4 ? 30 : 20
    }

    // MARK: - MTKView subclass that renders below native resolution

    final class BurstMTKView: MTKView {
        var renderScale: CGFloat = 0.6
        override func layoutSubviews() {
            super.layoutSubviews()
            let scale = contentScaleFactor > 0 ? contentScaleFactor : 2
            let w = max(1, bounds.width * scale * renderScale)
            let h = max(1, bounds.height * scale * renderScale)
            drawableSize = CGSize(width: w, height: h)
        }
    }

    // MARK: - Renderer

    final class Renderer: NSObject, MTKViewDelegate {
        // A refined, cool "prismatic wisdom" spectrum: indigo → violet →
        // magenta → blue → teal (matches the web palette).
        private static let palette: [SIMD4<Float>] = [
            hex(0x1E2A6E), hex(0x5B3FD6), hex(0x9B5BE0),
            hex(0xE15CC0), hex(0x4F8FF7), hex(0x46E0D2),
        ]
        private static let baseDistort: Float = 1.5

        let device: MTLDevice = MTLCreateSystemDefaultDevice()!
        private lazy var queue: MTLCommandQueue = device.makeCommandQueue()!
        private var pipeline: MTLRenderPipelineState?
        private var colorBuffer: MTLBuffer?

        var targetIntensity: Float = 0.05

        private var animTime: Float = 0
        private var speed: Float = 0
        private var bright: Float = 0
        private var dist: Float = 0
        private var lastTime: CFTimeInterval = 0
        private var primed = false
        private var thermalSkip = false

        // After a long stretch sitting at the calm baseline (nothing on screen
        // is changing — the user is just reading), drop further still. Any
        // rise in intensity re-triggers `updateUIView`, which resets the rate
        // via `frameRate(intensity:lowPower:)`, so this self-heals.
        private var idleSince: CFTimeInterval?
        private static let idleThreshold: CFTimeInterval = 6.0
        private static let deepIdleFPS = 10

        func configure() {
            guard pipeline == nil, let library = device.makeDefaultLibrary() else { return }
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = library.makeFunction(name: "burst_vertex")
            desc.fragmentFunction = library.makeFunction(name: "burst_fragment")
            desc.colorAttachments[0].pixelFormat = .bgra8Unorm
            pipeline = try? device.makeRenderPipelineState(descriptor: desc)
            colorBuffer = device.makeBuffer(
                bytes: Self.palette,
                length: MemoryLayout<SIMD4<Float>>.stride * Self.palette.count,
                options: .storageModeShared)
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

        func draw(in view: MTKView) {
            // Back off automatically as the device warms: under thermal
            // pressure, render every other frame (halving the GPU load).
            switch ProcessInfo.processInfo.thermalState {
            case .serious, .critical:
                thermalSkip.toggle()
                if thermalSkip { return }
            default:
                thermalSkip = false
            }

            guard let pipeline,
                  let colorBuffer,
                  let drawable = view.currentDrawable,
                  let pass = view.currentRenderPassDescriptor,
                  let cmd = queue.makeCommandBuffer(),
                  let enc = cmd.makeRenderCommandEncoder(descriptor: pass)
            else { return }

            let now = CACurrentMediaTime()
            let dt = lastTime == 0 ? 1.0 / 60.0 : min(now - lastTime, 0.05)
            lastTime = now

            if targetIntensity <= 0.06 {
                if idleSince == nil { idleSince = now }
                if let idleSince, now - idleSince > Self.idleThreshold,
                   view.preferredFramesPerSecond != Self.deepIdleFPS {
                    view.preferredFramesPerSecond = Self.deepIdleFPS
                }
            } else {
                idleSince = nil
            }

            // Snap on the first frame, then ease so phase changes glide.
            if !primed {
                speed = mapSpeed(targetIntensity)
                bright = mapBright(targetIntensity)
                dist = mapDistort(targetIntensity)
                primed = true
            } else {
                let k = Float(min(dt * 2.0, 1.0))
                speed += (mapSpeed(targetIntensity) - speed) * k
                bright += (mapBright(targetIntensity) - bright) * k
                dist += (mapDistort(targetIntensity) - dist) * k
            }
            animTime += Float(dt) * speed

            let size = view.drawableSize
            var u = Uniforms(
                resolution: SIMD2<Float>(Float(size.width), Float(size.height)),
                time: animTime,
                intensity: bright,
                speed: 1,
                distort: dist,
                offset: SIMD2<Float>(0, 0),
                noiseAmount: 0.8,
                colorCount: Int32(Self.palette.count),
                rayCount: 0)

            enc.setRenderPipelineState(pipeline)
            enc.setFragmentBytes(&u, length: MemoryLayout<Uniforms>.stride, index: 0)
            enc.setFragmentBuffer(colorBuffer, offset: 0, index: 1)
            enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
            enc.endEncoding()
            cmd.present(drawable)
            cmd.commit()
        }

        // Conversation energy → shader speed / brightness / distortion. Wide
        // ranges so rest and thinking look dramatically different.
        private func mapSpeed(_ it: Float) -> Float { 0.15 + it * 1.55 }
        private func mapBright(_ it: Float) -> Float { 1.4 + it * 1.15 }
        private func mapDistort(_ it: Float) -> Float { Self.baseDistort + it * 5.5 }

        private static func hex(_ v: UInt32) -> SIMD4<Float> {
            SIMD4<Float>(Float((v >> 16) & 0xFF) / 255,
                         Float((v >> 8) & 0xFF) / 255,
                         Float(v & 0xFF) / 255, 1)
        }
    }
}

/// Mirrors the `Uniforms` struct in PrismaticBurst.metal (field order + types
/// chosen so Swift and MSL agree on layout without manual padding).
struct Uniforms {
    var resolution: SIMD2<Float>
    var time: Float
    var intensity: Float
    var speed: Float
    var distort: Float
    var offset: SIMD2<Float>
    var noiseAmount: Float
    var colorCount: Int32
    var rayCount: Int32
}
