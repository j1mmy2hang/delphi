import Foundation
import NaturalLanguage

/// Programmatic backstop for the "reply in the user's language" rule.
///
/// The system prompt already asks for this, but a rule stated once in a long
/// prompt can drift over a conversation. This detects the user's language(s)
/// on-device, has `ConversationModel` steer each request with it, and lets it
/// verify the reply actually landed in that language before showing it.
enum LanguageGuard {
    /// Below this length, on-device language ID is too unreliable (single
    /// words, "ok", emoji) to act on — enforcement is skipped entirely.
    private static let minDetectableLength = 6

    /// A second candidate language counts as "also in play" (mixed-language
    /// input) above this confidence, so the reply may use either.
    private static let mixedLanguageThreshold: Double = 0.2

    /// The language(s) present in `text`, or `nil` if it's too short/ambiguous
    /// to detect with any confidence.
    static func expectedLanguages(for text: String) -> Set<NLLanguage>? {
        guard text.count >= minDetectableLength else { return nil }
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        guard let dominant = recognizer.dominantLanguage else { return nil }
        var languages: Set<NLLanguage> = [dominant]
        for (language, confidence) in recognizer.languageHypotheses(withMaximum: 3)
        where confidence >= mixedLanguageThreshold {
            languages.insert(language)
        }
        return languages
    }

    /// Whether `reply`'s dominant language is one of `expected`. Reasoning/tag
    /// markup is stripped first so a leftover `<situation n>` tag can't skew
    /// detection toward the wrong language.
    static func matches(reply: String, expected: Set<NLLanguage>) -> Bool {
        let stripped = Stage.stripTags(reply)
        guard stripped.count >= minDetectableLength else { return true }
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(stripped)
        guard let dominant = recognizer.dominantLanguage else { return true }
        return expected.contains(dominant)
    }

    /// Human-readable form for steering the model, e.g. "Chinese" or
    /// "Chinese and English".
    static func names(for languages: Set<NLLanguage>) -> String {
        let locale = Locale(identifier: "en")
        let names = languages
            .compactMap { locale.localizedString(forLanguageCode: $0.rawValue) }
            .sorted()
        switch names.count {
        case 0: return "the same language as my last message"
        case 1: return names[0]
        default: return names.joined(separator: " and ")
        }
    }
}
