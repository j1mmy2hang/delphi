import Foundation
import Security

/// A stable, anonymous per-install identifier used only so the backend can meter
/// usage per device (the free / paid monthly budget). It is a random UUID with
/// no link to the person; it lives in the Keychain so it survives app deletion
/// and reinstall (which stops trivially resetting the free allowance). Not used
/// for tracking or advertising.
enum DeviceIdentity {
    private static let service = "com.jimmyzhang.delphi.device"
    private static let account = "device-id"

    /// The current id, generating and persisting one on first access.
    static let current: String = {
        if let existing = read() { return existing }
        let fresh = UUID().uuidString
        save(fresh)
        return fresh
    }()

    private static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let id = String(data: data, encoding: .utf8) else { return nil }
        return id
    }

    private static func save(_ id: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(id.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
}
