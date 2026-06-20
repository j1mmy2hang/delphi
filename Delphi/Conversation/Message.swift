import Foundation

/// One turn in the conversation. Matches the JSON the backend expects
/// (`{ role, content }`), so it doubles as the wire format.
struct Message: Codable, Equatable {
    enum Role: String, Codable {
        case user
        case assistant
    }
    var role: Role
    var content: String
}
