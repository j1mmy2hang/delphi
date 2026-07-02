import SwiftUI

/// Full-screen acceptance shown on first launch (and after a Terms/Privacy
/// update) until the user agrees. Required for AI-content apps: a clear agreement
/// plus links to the hosted Terms and Privacy Policy. Uses native controls
/// (Link, Button) over the app's dark stage. The AI disclaimer lives in the
/// linked Terms the user accepts here — no need to repeat it on screen.
struct TermsGateView: View {
    let onAccept: () -> Void

    private let termsURL = URL(string: "https://delphi-web.netlify.app/terms.html")!
    private let privacyURL = URL(string: "https://delphi-web.netlify.app/privacy.html")!

    var body: some View {
        ZStack {
            Color(hex: 0x05050C).ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 16) {
                    Text("Delphi")
                        .font(Typeface.serif(52))
                        .tracking(1.2)
                        .foregroundStyle(Color.stageText)

                    Text("Think Deeper, Clearer, Better")
                        .font(Typeface.serif(19))
                        .foregroundStyle(Color.stageSecondary)
                }

                Spacer()
                Spacer()

                VStack(spacing: 18) {
                    HStack(spacing: 4) {
                        Text("By continuing you agree to our")
                            .foregroundStyle(Color.stageTertiary)
                        Link("Terms", destination: termsURL)
                        Text("&")
                            .foregroundStyle(Color.stageTertiary)
                        Link("Privacy", destination: privacyURL)
                    }
                    .font(.system(size: 13))
                    .tint(Color.stageAccent)

                    Button(action: onAccept) {
                        Text("Agree & Continue")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Color.stageAccentText)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(Capsule().fill(Color.stageAccent))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 40)
        }
        .preferredColorScheme(.dark)
    }
}
