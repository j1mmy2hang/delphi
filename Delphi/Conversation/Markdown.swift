import Foundation

/// Text shaping for the stage. Mirrors the web app's markdown util: it strips
/// the model's reasoning/`<situation n>` tags, splits text into paragraphs, and
/// (for assistant replies) renders inline bold/italic.
enum Stage {
    /// Removes reasoning blocks (`<think>…`, possibly unclosed while streaming)
    /// and stray inline tags like `<situation 1>`, then tidies whitespace.
    static func stripTags(_ text: String) -> String {
        var s = text
        // Reasoning blocks — matched to the closing tag or end-of-string.
        s = replacing(
            s,
            pattern: "<(think|thinking|reasoning|reflection|analysis|scratchpad)\\b[^>]*>[\\s\\S]*?(?:</\\1>|$)",
            with: "",
            options: [.caseInsensitive])
        s = replacing(s, pattern: "<[^>]*>", with: "")   // standalone tags
        s = replacing(s, pattern: "<[^>]*$", with: "")    // partial tag still arriving
        s = replacing(s, pattern: "\\n{3,}", with: "\n\n")
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Blank-line-separated blocks, each trimmed; empty blocks dropped.
    static func paragraphs(_ text: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: "\\n{2,}") else { return [text] }
        let ns = text as NSString
        var result: [String] = []
        var cursor = 0
        for match in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result.append(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            cursor = match.range.location + match.range.length
        }
        result.append(ns.substring(from: cursor))
        return result
            .map { $0.trimmingCharacters(in: .newlines) }
            .filter { !$0.isEmpty }
    }

    /// Inline markdown (bold/italic) for one paragraph, preserving its single
    /// line breaks. Falls back to plain text if parsing fails.
    static func inline(_ paragraph: String, markdown: Bool) -> AttributedString {
        guard markdown else { return AttributedString(paragraph) }
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: paragraph, options: options))
            ?? AttributedString(paragraph)
    }

    // MARK: -

    private static func replacing(
        _ s: String, pattern: String, with template: String,
        options: NSRegularExpression.Options = []
    ) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return s }
        let range = NSRange(s.startIndex..., in: s)
        return re.stringByReplacingMatches(in: s, range: range, withTemplate: template)
    }
}
