import SwiftUI

/// The whole stage: the prismatic burst, a focal scrim, the single living
/// message, the ascending hand-off, and the Liquid Glass input dock.
struct ContentView: View {
    @State private var model = ConversationModel()
    @State private var input = ""
    @State private var flight: Flight?
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase

    /// The words in mid-ascent from the input to the centre.
    private struct Flight: Identifiable {
        let id = UUID()
        let text: String
        let startY: CGFloat
    }

    var body: some View {
        GeometryReader { geo in
            let maxHeight = geo.size.height * 0.66

            ZStack {
                PrismaticBurstView(intensity: model.intensity, active: scenePhase == .active)
                    .ignoresSafeArea()

                // Tap empty space to dismiss the keyboard.
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { focused = false }
                    .ignoresSafeArea()

                // Focal scrim — gently darkens the centre so a message reads
                // while the burst keeps glowing around it.
                RadialGradient(
                    gradient: Gradient(stops: [
                        .init(color: Color(hex: 0x05050C, opacity: 0.62), location: 0),
                        .init(color: Color(hex: 0x05050C, opacity: 0.32), location: 0.58),
                        .init(color: .clear, location: 1),
                    ]),
                    center: UnitPoint(x: 0.5, y: 0.53),
                    startRadius: 0,
                    endRadius: max(geo.size.width, geo.size.height) * 0.5)
                .ignoresSafeArea()
                .allowsHitTesting(false)

                MessageStageView(model: model, maxHeight: maxHeight)
                    .padding(.horizontal, 28)
                    .ignoresSafeArea(.keyboard)

                if let flight {
                    AscendingMessageView(
                        text: flight.text,
                        startY: flight.startY,
                        maxHeight: maxHeight
                    ) {
                        model.arrive()
                        self.flight = nil
                    }
                    .id(flight.id)
                    .padding(.horizontal, 28)
                    .ignoresSafeArea(.keyboard)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .overlay(alignment: .bottom) {
                InputDockView(
                    text: $input,
                    started: model.started,
                    busy: model.busy,
                    focused: $focused,
                    onSend: { send(viewportHeight: geo.size.height) },
                    onNewChat: {
                        model.reset()
                        input = ""
                        flight = nil
                        focused = false
                    })
            }
        }
        .background(Color.black)
        .preferredColorScheme(.dark)
    }

    private func send(viewportHeight: CGFloat) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !model.busy else { return }
        input = ""
        focused = false
        // Launch the words from the input up to the centre. 0.40·height matches
        // the resting centre (0.52) sitting above a dock near the bottom.
        flight = Flight(text: trimmed, startY: viewportHeight * 0.40)
        model.submit(trimmed)
    }
}
