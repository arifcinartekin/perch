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

  // MARK: Perch account

  private static let communityService = "app.perch.community"

  /// The Perch account's session token: a separate item, since the account
  /// can live on a different server from the library.
  static func communityToken(for server: URL) -> String? {
    var query = communityQuery(server)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func setCommunityToken(_ token: String?, for server: URL) {
    SecItemDelete(communityQuery(server) as CFDictionary)
    guard let token else { return }
    var query = communityQuery(server)
    query[kSecValueData as String] = Data(token.utf8)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(query as CFDictionary, nil)
  }

  private static func communityQuery(_ server: URL) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: communityService,
      kSecAttrAccount as String: server.absoluteString,
    ]
  }

  // MARK: Sync chain

  private static let chainService = "app.perch.chain"

  /// The chain this phone is in, with its code: the code is the key to
  /// everything the chain syncs, so it lives here rather than in the library.
  static func chain() -> ChainAccount? {
    var query = chainQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(ChainAccount.self, from: data)
  }

  static func setChain(_ account: ChainAccount?) {
    SecItemDelete(chainQuery as CFDictionary)
    guard let account, let data = try? JSONEncoder().encode(account) else { return }
    var query = chainQuery
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(query as CFDictionary, nil)
  }

  private static var chainQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: chainService,
      kSecAttrAccount as String: "chain",
    ]
  }

  private static func base(_ server: URL) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: server.absoluteString,
    ]
  }
}
