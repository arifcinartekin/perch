import Foundation
import Security

/// The session token, kept in the Keychain (this device only, after first unlock).
enum Keychain {
  private static let service = "app.perch.session"

  static func token(for server: URL) -> String? {
    var query = base(server)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func setToken(_ token: String?, for server: URL) {
    SecItemDelete(base(server) as CFDictionary)
    guard let token else { return }
    var query = base(server)
    query[kSecValueData as String] = Data(token.utf8)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(query as CFDictionary, nil)
  }

  private static func base(_ server: URL) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: server.absoluteString,
    ]
  }
}
