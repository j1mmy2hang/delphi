import SwiftUI

/// The single living message — its text content for each speaker. User question
/// and assistant reply share one identical serif treatment so the hand-off from
/// the ascending overlay is invisible.
struct StageMessage: View {
    let role: ConversationModel.Speaker
    let text: String
    let maxHeight: CGFloat

    var body: some View {
        content
            .font(Typeface.serif(25))
            .tracking(0.2)
            .lineSpacing(7)
            .multilineTextAlignment(.center)
            .foregroundStyle(Color.stageText)
            .frame(maxWidth: 560)
    }

    @ViewBuilder private var content: some View {
        switch role {
        case .idle:
            VStack(spacing: 16) {
                Text("Delphi")
                    .font(Typeface.serif(56))
                    .tracking(1.5)
                Text("Think Deeper, Clearer, Better")
                    .font(Typeface.serif(19))
                    .tracking(0.4)
                    .foregroundStyle(Color.stageSecondary)
            }
        case .user:
            paragraphs(of: text, markdown: false)
        case .assistant:
            paragraphs(of: Stage.stripTags(text), markdown: true)
        }
    }

    private func paragraphs(of source: String, markdown: Bool) -> some View {
        let blocks = Stage.paragraphs(source)
        return StageScroll(maxHeight: maxHeight) {
            VStack(spacing: 14) {
                ForEach(blocks.indices, id: \.self) { i in
                    Text(Stage.inline(blocks[i], markdown: markdown))
                }
            }
        }
    }
}

/// Centres a message and, when it's taller than its bounds, scrolls with a soft
/// top/bottom fade so the reader can tell there's more. ViewThatFits picks the
/// plain (centred) layout when the content fits and the scrolling layout when it
/// doesn't — no manual measurement.
struct StageScroll<Content: View>: View {
    let maxHeight: CGFloat
    let content: Content

    init(maxHeight: CGFloat, @ViewBuilder content: () -> Content) {
        self.maxHeight = maxHeight
        self.content = content()
    }

    var body: some View {
        ViewThatFits(in: .vertical) {
            content
            ScrollView(.vertical) { content }
                .scrollIndicators(.hidden)
                .scrollBounceBehavior(.basedOnSize)
                .mask(edgeFade)
        }
        .frame(maxHeight: maxHeight)
    }

    private var edgeFade: some View {
        LinearGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .black, location: 0.07),
                .init(color: .black, location: 0.93),
                .init(color: .clear, location: 1),
            ],
            startPoint: .top, endPoint: .bottom)
    }
}

/// Drives the materialise / dissolve choreography. Every message — question or
/// reply — coalesces out of the cloud and melts back into it the same way: a
/// blur + scale + drift that reads as forming from / dissolving into the wave.
struct MessageStageView: View {
    let model: ConversationModel
    let maxHeight: CGFloat

    // REST = (1, 0, 0, 1); ENTER and EXIT are the cloud states.
    @State private var opacity: Double = 0
    @State private var blurRadius: Double = 22
    @State private var yOffset: CGFloat = 12
    @State private var scale: Double = 0.9

    var body: some View {
        StageMessage(role: model.role, text: model.text, maxHeight: maxHeight)
            .stageHalo()
            .scaleEffect(scale)
            .offset(y: yOffset)
            .blur(radius: blurRadius)
            .opacity(opacity)
            .onAppear { apply(model.phase) }
            .onChange(of: model.phase) { _, phase in apply(phase) }
    }

    private func apply(_ phase: ConversationModel.Phase) {
        switch phase {
        case .idle:                  // the wordmark coalesces out of the cloud
            materialise(1.4)
        case .forming:               // the reply forms out of the cloud
            materialise(ConversationModel.Choreo.form)
        case .dissolving:            // the message melts back into the wave
            withAnimation(.stageEase(ConversationModel.Choreo.dissolve)) {
                opacity = 0; blurRadius = 22; yOffset = -10; scale = 1.12
            }
        case .thinking, .settled:    // resting at centre (incl. the ascent hand-off)
            snap(opacity: 1, blur: 0, y: 0, scale: 1)
        case .rising:
            break                    // handled by the AscendingMessage overlay
        }
    }

    private func materialise(_ duration: Double) {
        snap(opacity: 0, blur: 22, y: 12, scale: 0.9)
        DispatchQueue.main.async {
            withAnimation(.stageSettle(duration)) {
                opacity = 1; blurRadius = 0; yOffset = 0; scale = 1
            }
        }
    }

    private func snap(opacity o: Double, blur b: Double, y: CGFloat, scale s: Double) {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            opacity = o; blurRadius = b; yOffset = y; scale = s
        }
    }
}
