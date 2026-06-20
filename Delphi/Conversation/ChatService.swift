import Foundation

/// Talks to the same serverless backend the web app uses. The API key and
/// system prompt stay server-side (in the Netlify function) — the app only
/// ever sees the streamed reply, which keeps secrets out of the binary.
///
/// Point `endpoint` at your deployment. The default is the project's Netlify
/// site; change `Endpoint.base` (or the whole URL) to your own.
struct ChatService {
    enum Endpoint {
        /// Your deployed site. Override here to point at a different backend.
        static let base = "https://delphi-web.netlify.app"
        static let chat = URL(string: "\(base)/.netlify/functions/chat")!
    }

    /// Streams a reply for the given history and returns the full text once the
    /// stream completes. The stage reveals replies whole (like the web app), so
    /// we accumulate rather than surface partial tokens.
    func reply(to history: [Message]) async throws -> String {
        var request = URLRequest(url: Endpoint.chat)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(ChatRequest(messages: history))

        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await URLSession.shared.bytes(for: request)
        } catch {
            #if DEBUG
            // No backend reachable (e.g. running before deploy): let the design
            // be experienced offline with a canned oracle reply.
            return try await Self.simulatedReply()
            #else
            throw error
            #endif
        }

        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            #if DEBUG
            return try await Self.simulatedReply()
            #else
            throw URLError(.badServerResponse)
            #endif
        }

        var accumulated = ""
        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let payload = line.dropFirst(6)
            if payload == "[DONE]" { continue }
            if let data = payload.data(using: .utf8),
               let chunk = try? JSONDecoder().decode(StreamChunk.self, from: data),
               let delta = chunk.choices.first?.delta.content {
                accumulated += delta
            }
        }
        return accumulated
    }

    // MARK: - Wire types

    private struct ChatRequest: Encodable {
        let messages: [Message]
    }

    private struct StreamChunk: Decodable {
        struct Choice: Decodable {
            struct Delta: Decodable { let content: String? }
            let delta: Delta
        }
        let choices: [Choice]
    }

    // MARK: - Offline preview

    #if DEBUG
    private static func simulatedReply() async throws -> String {
        let reply = """
        The clearest thinking rarely arrives as a single answer. It surfaces as \
        a better question — one that quietly reframes what you were certain you \
        already knew. Sit with the tension a moment longer than feels \
        comfortable, and notice what it is protecting.
        """
        // Mimic the latency of a real turn so the wave churns convincingly.
        try await Task.sleep(for: .milliseconds(900))
        return reply
    }
    #endif
}
