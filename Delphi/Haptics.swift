import CoreHaptics

/// The app's haptic voice. Core Haptics drives every cue so they share one
/// physical vocabulary, woven into the conversation's choreography:
///
///   • `tap`    — a soft touch when the input bar is focused
///   • `send`   — a crisp tick that swells upward, like the words lifting off
///   • `answer` — a strong climax that lands as the reply forms from the cloud
///
/// No-ops cleanly wherever haptics aren't available — iPad (no Taptic Engine),
/// the Simulator, or with Settings ▸ Sounds & Haptics ▸ System Haptics off — so
/// callers never need to check. A dropped cue is never worth a crash.
final class Haptics {
    static let shared = Haptics()

    private let supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics
    private var engine: CHHapticEngine?

    private init() {}

    // MARK: - Engine lifecycle

    /// Warm the engine up ahead of the first cue (call on appear).
    func prepare() {
        guard supported, engine == nil else { return }
        do {
            let engine = try CHHapticEngine()
            engine.isAutoShutdownEnabled = true              // sleeps when idle (power)
            engine.resetHandler = { [weak engine] in try? engine?.start() }
            engine.stoppedHandler = { _ in }
            try engine.start()
            self.engine = engine
        } catch {
            // Leave engine nil → every cue silently no-ops.
        }
    }

    private func started() -> CHHapticEngine? {
        guard supported else { return nil }
        if engine == nil { prepare() }
        try? engine?.start()   // wake it if auto-shutdown put it to sleep
        return engine
    }

    // MARK: - Discrete cues

    /// A soft touch — the input bar gains focus.
    func tap() {
        play(transient: 0.45, sharpness: 0.5)
    }

    /// A crisp tick that blooms into a short upward swell — the thought lifts
    /// off and ascends to the centre.
    func send() {
        guard let engine = started() else { return }
        let events = [
            CHHapticEvent(eventType: .hapticTransient, parameters: [
                .init(parameterID: .hapticIntensity, value: 0.7),
                .init(parameterID: .hapticSharpness, value: 0.65),
            ], relativeTime: 0),
            CHHapticEvent(eventType: .hapticContinuous, parameters: [
                .init(parameterID: .hapticIntensity, value: 0.4),
                .init(parameterID: .hapticSharpness, value: 0.4),
            ], relativeTime: 0, duration: 0.35),
        ]
        let swell = CHHapticParameterCurve(parameterID: .hapticIntensityControl, controlPoints: [
            .init(relativeTime: 0, value: 0.3),
            .init(relativeTime: 0.35, value: 1.0),
        ], relativeTime: 0)
        play(events: events, curves: [swell], on: engine)
    }

    /// A swell that builds as the reply coalesces out of the cloud and resolves
    /// in a strong climax landing exactly as the text finishes forming. Pass the
    /// stage's materialise duration (`Choreo.form`) so the hit and the visual
    /// settle land together.
    func answer(duration: TimeInterval) {
        guard let engine = started() else { return }
        // EASE_SETTLE front-loads the materialise, so the text reads as "arrived"
        // before its formal end — climax a touch before `duration` to land with
        // the perceived settle rather than the slow tail.
        let climax = duration * 0.82
        let events = [
            CHHapticEvent(eventType: .hapticContinuous, parameters: [
                .init(parameterID: .hapticIntensity, value: 0.6),
                .init(parameterID: .hapticSharpness, value: 0.3),
            ], relativeTime: 0, duration: climax),
            // the climax — strong hit + bright accent
            CHHapticEvent(eventType: .hapticTransient, parameters: [
                .init(parameterID: .hapticIntensity, value: 1.0),
                .init(parameterID: .hapticSharpness, value: 0.5),
            ], relativeTime: climax),
            CHHapticEvent(eventType: .hapticTransient, parameters: [
                .init(parameterID: .hapticIntensity, value: 0.8),
                .init(parameterID: .hapticSharpness, value: 0.85),
            ], relativeTime: climax),
        ]
        // A faint build that surges into the climax, mirroring the reply
        // coalescing — no dip, just a rise.
        let swell = CHHapticParameterCurve(parameterID: .hapticIntensityControl, controlPoints: [
            .init(relativeTime: 0, value: 0.4),
            .init(relativeTime: climax * 0.6, value: 0.6),
            .init(relativeTime: climax, value: 1.0),
        ], relativeTime: 0)
        play(events: events, curves: [swell], on: engine)
    }

    // MARK: - Helpers

    private func play(transient intensity: Float, sharpness: Float) {
        guard let engine = started() else { return }
        let event = CHHapticEvent(eventType: .hapticTransient, parameters: [
            .init(parameterID: .hapticIntensity, value: intensity),
            .init(parameterID: .hapticSharpness, value: sharpness),
        ], relativeTime: 0)
        play(events: [event], curves: [], on: engine)
    }

    private func play(events: [CHHapticEvent], curves: [CHHapticParameterCurve], on engine: CHHapticEngine) {
        do {
            let pattern = try CHHapticPattern(events: events, parameterCurves: curves)
            let player = try engine.makePlayer(with: pattern)
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            // A dropped haptic is never worth a crash.
        }
    }
}
