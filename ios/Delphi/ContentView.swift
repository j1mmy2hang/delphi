import SwiftUI

/// The whole stage: the prismatic burst, a focal scrim, the single living
/// message, the ascending hand-off, and the Liquid Glass input dock.
struct ContentView: View {
    @State private var model = ConversationModel()
    @State private var store = SubscriptionStore()
    @State private var input = ""
    @State private var flight: Flight?
    @FocusState private var focused: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @AppStorage("delphi.acceptedTermsVersion") private var acceptedTermsVersion = 0

    /// Bump when the Terms/Privacy change to re-prompt acceptance.
    private static let currentTermsVersion = 1

    private static let termsURL = URL(string: "https://delphi-web.netlify.app/terms.html")!
    private static let privacyURL = URL(string: "https://delphi-web.netlify.app/privacy.html")!

    /// The words in mid-ascent from the input to the centre.
    private struct Flight: Identifiable {
        let id = UUID()
        let text: String
        let startY: CGFloat
    }

    var body: some View {
        GeometryReader { geo in
            let maxHeight = geo.size.height * 0.66
            let typeScale = Self.typeScale(for: geo.size)

            ZStack {
                PrismaticBurstView(
                    intensity: model.intensity,
                    active: scenePhase == .active,
                    lowPower: focused)
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

                MessageStageView(model: model, maxHeight: maxHeight, typeScale: typeScale)
                    .padding(.horizontal, 28)
                    .ignoresSafeArea(.keyboard)

                if let flight {
                    AscendingMessageView(
                        text: flight.text,
                        startY: flight.startY,
                        maxHeight: maxHeight,
                        typeScale: typeScale
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
            // Persistent utilities menu (native). Keeps subscription, restore, and
            // legal links reachable anytime — required for a subscription app —
            // plus the report action once a reply has settled.
            .overlay(alignment: .topTrailing) {
                Menu {
                    if model.role == .assistant, model.phase == .settled {
                        Button(role: .destructive) {
                            reportCurrentReply()
                        } label: {
                            Label("Report response", systemImage: "flag")
                        }
                    }
                    if !store.isSubscribed {
                        Button {
                            purchaseUpgrade()
                        } label: {
                            Label("Unlock more usage", systemImage: "sparkles")
                        }
                    }
                    Button {
                        restorePurchases()
                    } label: {
                        Label("Restore Purchases", systemImage: "arrow.clockwise")
                    }
                    Divider()
                    Button {
                        openURL(Self.termsURL)
                    } label: {
                        Label("Terms of Use", systemImage: "doc.text")
                    }
                    Button {
                        openURL(Self.privacyURL)
                    } label: {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.stageText)
                        .frame(width: 40, height: 40)
                        .liquidGlassCircle()
                        .contentShape(Circle())
                }
                .padding(.top, 6)
                .padding(.trailing, 12)
            }
        }
        .background(Color.black)
        .preferredColorScheme(.dark)
        .onAppear {
            Haptics.shared.prepare()
            model.isPaid = store.isSubscribed
        }
        // A soft touch when the bar is tapped into.
        .onChange(of: focused) { _, isFocused in
            if isFocused { Haptics.shared.tap() }
        }
        // A strong climax that lands as the reply forms out of the cloud.
        .onChange(of: model.phase) { _, phase in
            if phase == .forming {
                Haptics.shared.answer(duration: ConversationModel.Choreo.form)
            }
        }
        // A limit can interrupt a turn mid-ascent — clear the flying words.
        .onChange(of: model.limitNotice) { _, notice in
            if notice != nil {
                flight = nil
                focused = false
                Haptics.shared.tap()
            }
        }
        // Keep the tier in sync with the live subscription state.
        .onChange(of: store.isSubscribed) { _, subscribed in
            model.isPaid = subscribed
        }
        // Native limit window.
        .alert(limitTitle, isPresented: limitPresented) {
            if model.limitNotice?.isPaid == true {
                Button("OK", role: .cancel) { model.dismissLimit() }
            } else {
                Button("Unlock more usage") { purchaseUpgrade() }
                Button("Not now", role: .cancel) { model.dismissLimit() }
            }
        } message: {
            Text(limitMessage)
        }
        // First-launch terms acceptance (required for AI apps).
        .fullScreenCover(isPresented: needsTerms) {
            TermsGateView { acceptedTermsVersion = Self.currentTermsVersion }
        }
    }

    // MARK: - Limit window

    private var limitPresented: Binding<Bool> {
        Binding(get: { model.limitNotice != nil }, set: { if !$0 { model.dismissLimit() } })
    }

    private var limitTitle: String {
        (model.limitNotice?.isPaid ?? false) ? "You've reached your limit" : "You've reached your free limit"
    }

    private var limitMessage: String {
        guard let notice = model.limitNotice else { return "" }
        let opener = notice.isPaid
            ? "You've used all your access for now."
            : "You've used all your free messages for now."
        guard let reset = notice.resetAt else { return opener + " Please try again later." }
        let date = reset.formatted(.dateTime.month(.wide).day())
        return notice.isPaid
            ? "\(opener) It resets on \(date)."
            : "\(opener) It resets on \(date), or unlock more usage to keep going."
    }

    private func purchaseUpgrade() {
        Task {
            _ = await store.purchase()
            model.isPaid = store.isSubscribed
        }
    }

    private func restorePurchases() {
        Task {
            await store.restore()
            model.isPaid = store.isSubscribed
        }
    }

    // MARK: - Terms & reporting

    private var needsTerms: Binding<Bool> {
        Binding(get: { acceptedTermsVersion < Self.currentTermsVersion }, set: { _ in })
    }

    /// Opens a pre-filled email to report the currently shown reply.
    private func reportCurrentReply() {
        let snippet = String(model.text.prefix(1500))
        let subject = "Delphi — report a response"
        let body = "I'd like to report this AI response:\n\n\"\(snippet)\"\n\nWhat's wrong with it?\n"
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let query = "?subject=\(subject.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
            + "&body=\(body.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        if let url = URL(string: "mailto:contact@jimmyzhang.org\(query)") {
            openURL(url)
        }
    }

    private func send(viewportHeight: CGFloat) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !model.busy else { return }
        #if DEBUG
        // Dev-only backdoor: preview the limit window without spending real
        // budget. "TEST_ADMIN" → free variant, "TEST_ADMIN_PAID" → paid variant.
        if trimmed == "TEST_ADMIN" || trimmed == "TEST_ADMIN_PAID" {
            input = ""
            focused = false
            model.fireTestLimit(paid: trimmed == "TEST_ADMIN_PAID")
            return
        }
        #endif
        Haptics.shared.send(duration: ConversationModel.Choreo.rise)
        input = ""
        focused = false
        // Launch the words from the input up to the centre. 0.40·height matches
        // the resting centre (0.52) sitting above a dock near the bottom.
        flight = Flight(text: trimmed, startY: viewportHeight * 0.40)
        model.submit(trimmed)
    }

    /// Scales the serif up on larger screens so the stage reads proportionally
    /// on iPad (in any orientation) instead of looking tiny, while staying 1×
    /// on iPhone. Keyed to the short edge so portrait and landscape match.
    private static func typeScale(for size: CGSize) -> CGFloat {
        let shortEdge = min(size.width, size.height)
        return min(max(shortEdge / 390, 1.0), 1.3)
    }
}

extension View {
    /// A round native Liquid Glass button surface on iOS 26, degrading to a
    /// translucent material on older systems so the project still builds/runs if
    /// the deployment target is lowered. (Sibling of `liquidGlassField`.)
    @ViewBuilder func liquidGlassCircle() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: Circle())
        } else {
            self
                .background(.regularMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.12)))
        }
    }
}
