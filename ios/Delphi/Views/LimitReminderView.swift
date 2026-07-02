import SwiftUI

/// The "you've reached your limit" window. It rises over the darkened stage as a
/// Liquid Glass card, matching the app's serif + accent language. Free users are
/// offered the upgrade; paid users just see when their access resets. Deliberately
/// never mentions the underlying dollar budget — only that more can be unlocked.
struct LimitReminderView: View {
    let notice: ConversationModel.LimitNotice
    let onUpgrade: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            // Dim + let the burst glow through faintly behind the card.
            Color.black.opacity(0.55)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { onDismiss() }

            card
                .padding(.horizontal, 34)
        }
    }

    private var card: some View {
        VStack(spacing: 20) {
            Text(title)
                .font(Typeface.serif(27))
                .tracking(0.2)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.stageText)

            Text(message)
                .font(.system(size: 15))
                .lineSpacing(3)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.stageSecondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 6) {
                if !notice.isPaid {
                    Button(action: onUpgrade) {
                        Text("Unlock more usage")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.stageAccentText)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Capsule().fill(Color.stageAccent))
                    }
                    .buttonStyle(.plain)
                }

                Button(action: onDismiss) {
                    Text(notice.isPaid ? "OK" : "Not now")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.stageSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 11)
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 2)
        }
        .padding(28)
        .frame(maxWidth: 340)
        .liquidGlassCard(cornerRadius: 30)
    }

    private var title: String {
        notice.isPaid ? "You've reached your limit" : "You've reached your free limit"
    }

    private var message: String {
        let opener = notice.isPaid
            ? "You've used all your access for now."
            : "You've used all your free thinking for now."
        guard let reset = notice.resetAt else {
            return opener + " Please try again later."
        }
        let tail = notice.isPaid
            ? " It resets on \(Self.dateText(reset))."
            : " It resets on \(Self.dateText(reset)), or unlock more usage now."
        return opener + tail
    }

    private static func dateText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMMM d"
        return formatter.string(from: date)
    }
}

extension View {
    /// A non-interactive Liquid Glass card on iOS 26, degrading to a translucent
    /// material on older systems so the project still builds/runs if the
    /// deployment target is lowered. (Sibling of `liquidGlassField`.)
    @ViewBuilder func liquidGlassCard(cornerRadius: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: shape)
        } else {
            self
                .background(.regularMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.white.opacity(0.12)))
        }
    }
}
