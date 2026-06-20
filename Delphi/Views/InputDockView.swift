import SwiftUI

/// The input — a genuine iOS Liquid Glass bar (not a CSS imitation). It's a
/// fixed-radius rounded rectangle: a pill at one line, and a clean rounded
/// rectangle as it grows with wrapped text (a capsule would balloon into a tall
/// stadium). Return sends; the send button fills with the accent when there's
/// something to send, and a soft accent ring breathes while the oracle works.
struct InputDockView: View {
    @Binding var text: String
    let started: Bool
    let busy: Bool
    var focused: FocusState<Bool>.Binding
    let onSend: () -> Void
    let onNewChat: () -> Void

    @State private var pulse = false

    /// Held constant so the field stays a rounded rectangle at any height. ~half
    /// the single-line height, so one line still reads as a pill.
    private let fieldCornerRadius: CGFloat = 22

    private var hasInput: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private var canSend: Bool { hasInput && !busy }

    var body: some View {
        VStack(spacing: 12) {
            if started {
                Button(action: onNewChat) {
                    Text("BEGIN AGAIN")
                        .font(.system(size: 12))
                        .tracking(1.4)
                        .foregroundStyle(Color.stageTertiary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .offset(y: 6)))
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField("Ask Delphi…", text: $text, axis: .vertical)
                    .focused(focused)
                    .lineLimit(1...5)
                    .font(.system(size: 17))
                    .foregroundStyle(Color.stageText)
                    .tint(Color.stageAccent)
                    .submitLabel(.send)
                    .onChange(of: text) { _, newValue in
                        // Return sends rather than inserting a newline. A
                        // vertical-axis TextField doesn't fire onSubmit, so we
                        // catch the inserted newline, strip it, and send.
                        guard newValue.contains("\n") else { return }
                        text = newValue.replacingOccurrences(of: "\n", with: "")
                        onSend()
                    }
                    .padding(.vertical, 7)
                    .padding(.leading, 10)

                sendButton
            }
            .padding(6)
            .liquidGlassField(cornerRadius: fieldCornerRadius)
            .overlay {
                RoundedRectangle(cornerRadius: fieldCornerRadius, style: .continuous)
                    .strokeBorder(Color.stageAccent.opacity(busy && pulse ? 0.5 : 0), lineWidth: 1)
                    .shadow(color: Color.stageAccent.opacity(busy && pulse ? 0.5 : 0), radius: 11)
                    .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 18)
        .padding(.bottom, 6)
        .animation(.spring(response: 0.42, dampingFraction: 0.82), value: started)
        .onChange(of: busy) { _, isBusy in
            if isBusy {
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulse = true }
            } else {
                withAnimation(.easeOut(duration: 0.3)) { pulse = false }
            }
        }
    }

    private var sendButton: some View {
        Button(action: onSend) {
            Image(systemName: "arrow.up")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(canSend ? Color.stageAccentText : Color.stageSecondary)
                .frame(width: 34, height: 34)
                .background {
                    Circle().fill(canSend ? Color.stageAccent : Color.white.opacity(0.08))
                }
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: canSend)
    }
}

extension View {
    /// A Liquid Glass rounded-rectangle field on iOS 26, degrading to a
    /// translucent material on anything older so the project still builds and
    /// runs if the deployment target is lowered.
    @ViewBuilder func liquidGlassField(cornerRadius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: shape)
        } else {
            self
                .background(.regularMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.white.opacity(0.12)))
        }
    }
}
