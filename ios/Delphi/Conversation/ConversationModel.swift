import SwiftUI
import Observation
import NaturalLanguage

/// One message on screen at a time, choreographed for continuity:
///   submit  → whatever is on screen melts into the wave while the typed words
///             ascend from the input to the centre
///   arrive  → the words land at centre and rest (the oracle thinks)
///   reveal  → once the reply is ready (and the words have rested a beat) they
///             dissolve into the cloud and the reply forms back out of it.
///
/// The ascent itself is the AscendingMessage overlay; this model owns the stage
/// state and timing, and `arrive()` is the hand-off from that overlay. A direct
/// port of the web app's useConversationStage + useChatStream.
@MainActor
@Observable
final class ConversationModel {
    enum Phase { case idle, rising, thinking, dissolving, forming, settled }
    enum Speaker { case idle, user, assistant }

    /// Choreography durations, in seconds.
    enum Choreo {
        static let rise = 1.25      // typed words ascend from input to centre
        static let dissolve = 1.05  // a message melts back into the cloud
        static let form = 1.25      // the reply forms out of the cloud
        static let minThink = 0.9   // min dwell before the question dissolves
    }

    /// Silent regeneration attempts if the reply's language still doesn't
    /// match the user's after the initial steering hint.
    private static let maxLanguageRetries = 2

    // The living stage trio the view renders.
    private(set) var phase: Phase = .idle
    private(set) var role: Speaker = .idle
    private(set) var text: String = ""
    private(set) var isStreaming = false

    /// Non-nil while the "you've reached your limit" window is showing.
    private(set) var limitNotice: LimitNotice?

    /// Whether this user currently has the paid subscription. Drives the X-Tier
    /// header sent to the backend and which reminder variant appears.
    /// TODO: wire to StoreKit (set true when an active subscription is verified).
    var isPaid = false

    /// What the limit window needs to render (captured when the limit fires).
    struct LimitNotice: Equatable {
        let resetAt: Date?
        let isPaid: Bool
    }

    // Conversation energy per phase (0 calm … 1 churning).
    var intensity: Double {
        switch phase {
        case .idle: 0.05
        case .rising: 0.45
        case .thinking: 0.85
        case .dissolving: 1.0
        case .forming: 0.5
        case .settled: 0.12
        }
    }

    /// A turn is in progress from send until the reply has fully settled.
    var busy: Bool {
        isStreaming || phase == .dissolving || phase == .forming || phase == .thinking
    }

    var started: Bool { !(role == .idle && phase == .idle) }

    @ObservationIgnored private let service = ChatService()
    @ObservationIgnored private var messages: [Message] = []
    @ObservationIgnored private var userText = ""
    @ObservationIgnored private var pendingReply: String?
    @ObservationIgnored private var restStart: Date?
    @ObservationIgnored private var revealing = false
    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var revealTask: Task<Void, Never>?
    @ObservationIgnored private var resetTask: Task<Void, Never>?

    // MARK: - Intents

    func submit(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        cancelAll()
        revealing = false
        pendingReply = nil
        userText = trimmed

        // Whatever is on screen melts into the wave while the words ascend.
        set(.dissolving, role, text)

        messages.append(Message(role: .user, content: trimmed))
        isStreaming = true
        let history = messages
        let expectedLanguages = LanguageGuard.expectedLanguages(for: trimmed)
        streamTask = Task { @MainActor [weak self] in
            guard let self else { return }
            let reply: String
            do {
                reply = try await self.requestReply(history: history, expectedLanguages: expectedLanguages)
            } catch ChatError.limitReached(let resetAt) {
                if Task.isCancelled { return }
                self.handleLimit(resetAt: resetAt)
                return
            } catch {
                reply = "抱歉，出了点问题。请重新开始对话。"
            }
            if Task.isCancelled { return }
            messages.append(Message(role: .assistant, content: reply))
            pendingReply = reply
            isStreaming = false
            maybeReveal()
        }
    }

    /// Requests a reply, steering it toward the language of the user's latest
    /// message and, if the model drifts anyway, silently retrying with a
    /// stronger nudge. The hint is only ever added to the outgoing copy of
    /// history — `messages` (what's shown on screen) keeps the user's text
    /// exactly as typed.
    private func requestReply(history: [Message], expectedLanguages: Set<NLLanguage>?) async throws -> String {
        guard let expectedLanguages, let lastIndex = history.indices.last else {
            return try await service.reply(to: history, paid: isPaid)
        }
        let languageName = LanguageGuard.names(for: expectedLanguages)
        let originalContent = history[lastIndex].content
        var wire = history

        wire[lastIndex].content = originalContent + "\n\n[Reply only in \(languageName).]"
        var reply = try await service.reply(to: wire, paid: isPaid)

        var attempt = 0
        while !LanguageGuard.matches(reply: reply, expected: expectedLanguages), attempt < Self.maxLanguageRetries {
            attempt += 1
            wire[lastIndex].content = originalContent +
                "\n\n[IMPORTANT: your previous reply was not in \(languageName). Reply only in \(languageName) this time.]"
            reply = try await service.reply(to: wire, paid: isPaid)
        }
        return reply
    }

    /// Called by the ascending overlay when the words reach the centre.
    func arrive() {
        guard limitNotice == nil else { return }  // a limit interrupted the turn
        restStart = Date()
        set(.thinking, .user, userText)
        maybeReveal()
    }

    func reset() {
        cancelAll()
        revealing = false
        pendingReply = nil
        messages.removeAll()
        isStreaming = false
        guard started else { return }
        set(.dissolving, role, text)
        resetTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Choreo.dissolve))
            guard let self, !Task.isCancelled else { return }
            set(.idle, .idle, "")
        }
    }

    // MARK: - Usage limit

    /// A real 429 from the backend: roll the in-flight turn back so history stays
    /// clean for a later retry, calm the stage, and raise the limit window.
    private func handleLimit(resetAt: Double?) {
        cancelAll()
        if messages.last?.role == .user { messages.removeLast() }
        isStreaming = false
        revealing = false
        pendingReply = nil
        set(.idle, .idle, "")
        let date = resetAt.map { Date(timeIntervalSince1970: $0) }
        limitNotice = LimitNotice(resetAt: date, isPaid: isPaid)
    }

    /// Wired to the TEST_ADMIN chat codes (DEBUG only, see ContentView) so the
    /// window can be previewed on device without exhausting the real budget.
    func fireTestLimit(paid: Bool) {
        cancelAll()
        isStreaming = false
        limitNotice = LimitNotice(resetAt: Self.startOfNextMonth(), isPaid: paid)
    }

    func dismissLimit() { limitNotice = nil }

    /// Begin the upgrade purchase. TODO: present the StoreKit sheet; on a verified
    /// purchase set `isPaid = true`. For now it just closes the window.
    func startUpgrade() { limitNotice = nil }

    /// Start of next calendar month — the fake reset instant for previews.
    private static func startOfNextMonth() -> Date {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month], from: Date())
        let startOfThisMonth = cal.date(from: comps) ?? Date()
        return cal.date(byAdding: .month, value: 1, to: startOfThisMonth) ?? Date()
    }

    // MARK: - Reveal

    /// Dissolve the rested question into the cloud and form the reply out of it.
    private func maybeReveal() {
        guard phase == .thinking else { return }   // words haven't landed yet
        guard let answer = pendingReply else { return } // reply not ready yet
        guard !revealing else { return }
        revealing = true
        pendingReply = nil

        let elapsed = restStart.map { Date().timeIntervalSince($0) } ?? 0
        let wait = max(0, Choreo.minThink - elapsed)
        revealTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(wait))
            guard let self, !Task.isCancelled else { return }
            set(.dissolving, .user, userText)
            try? await Task.sleep(for: .seconds(Choreo.dissolve))
            if Task.isCancelled { return }
            set(.forming, .assistant, answer)
            try? await Task.sleep(for: .seconds(Choreo.form))
            if Task.isCancelled { return }
            set(.settled, .assistant, answer)
            revealing = false
        }
    }

    // MARK: -

    private func set(_ phase: Phase, _ role: Speaker, _ text: String) {
        self.phase = phase
        self.role = role
        self.text = text
    }

    private func cancelAll() {
        streamTask?.cancel(); streamTask = nil
        revealTask?.cancel(); revealTask = nil
        resetTask?.cancel(); resetTask = nil
    }
}
