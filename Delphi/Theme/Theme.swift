import SwiftUI

// =============================================================================
// Design tokens — the native counterpart of the web app's CSS custom
// properties. The prismatic burst lives on a cinematic dark stage, so the whole
// app runs in dark mode (forced in Info.plist + ContentView).
// =============================================================================

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity)
    }

    static let stageText = Color(hex: 0xECEAF4)
    static let stageSecondary = Color(hex: 0x918FA6)
    static let stageTertiary = Color(hex: 0x5C5A74)
    static let stageAccent = Color(hex: 0x6E5BD6)
    static let stageAccentText = Color(hex: 0xF3F0FB)

    /// Dark halo that lifts light text off the vivid burst.
    static let halo = Color(hex: 0x06060E, opacity: 0.92)
    static let haloSoft = Color(hex: 0x06060E, opacity: 0.60)
}

enum Typeface {
    /// The brand serif. Apple's New York is the native serif — elegant and
    /// shipped with the system, so there's no web font to bundle.
    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }
}

extension Animation {
    /// Opacity-style fades — cubic-bezier(0.25, 0.1, 0.25, 1).
    static func stageEase(_ duration: Double) -> Animation {
        .timingCurve(0.25, 0.1, 0.25, 1, duration: duration)
    }
    /// A slow, organic "settle" — cubic-bezier(0.16, 1, 0.3, 1).
    static func stageSettle(_ duration: Double) -> Animation {
        .timingCurve(0.16, 1, 0.3, 1, duration: duration)
    }
}

/// The text halo (a soft dark shadow stack) that keeps every line legible over
/// the moving light, matching the web's layered text-shadow.
extension View {
    func stageHalo() -> some View {
        self
            .shadow(color: .halo, radius: 13)
            .shadow(color: .halo, radius: 5)
            .shadow(color: .haloSoft, radius: 1, y: 1)
    }
}
