import SwiftUI

/// The just-sent words lift out of the input and ascend to the stage's resting
/// centre, growing from input-size into the serif as they travel. It lands
/// pixel-identical to MessageStageView's user text, so the hand-off (arrive())
/// is invisible.
struct AscendingMessageView: View {
    let text: String
    /// Distance from the resting centre down to the input, in points.
    let startY: CGFloat
    let maxHeight: CGFloat
    let onArrived: () -> Void

    @State private var arrived = false

    // Roughly input font (17) over resting serif (~26) so the words start
    // input-sized and grow as they rise.
    private let startScale = 0.62

    var body: some View {
        StageMessage(role: .user, text: text, maxHeight: maxHeight)
            .stageHalo()
            .scaleEffect(arrived ? 1 : startScale)
            .offset(y: arrived ? 0 : startY)
            .blur(radius: arrived ? 0 : 1.5)
            .opacity(arrived ? 1 : 0.4)
            .onAppear {
                withAnimation(.stageSettle(ConversationModel.Choreo.rise)) {
                    arrived = true
                } completion: {
                    onArrived()
                }
            }
    }
}
