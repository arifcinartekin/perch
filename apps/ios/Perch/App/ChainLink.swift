import Foundation
import Observation
import PerchKit

/// The chain this phone is in: its relay, its code, and this device's clock id.
struct ChainAccount: Codable, Sendable, Equatable {
  var server: URL
  var code: String
  var node: String
}

/// Sync without an account: the library on this phone, kept in step with the
/// other devices in a chain through a relay that only sees encrypted records.
/// Starting, joining and leaving, and the rounds themselves (the merging is
/// LocalBackend's).
@MainActor @Observable
final class ChainLink {
  private(set) var account: ChainAccount?
  private(set) var syncing = false
  private(set) var lastSyncAt: Date?
  private(set) var lastError: ChainLink.Problem?

  enum Problem: Equatable {
    /// Another device deleted the chain.
    case ended
    case unreachable
    case other(String)
  }

  init() {
    account = Keychain.chain()
  }

  var isOn: Bool { account != nil }

  /// Picks up where the last launch left off.
  func prepare(_ backend: LocalBackend) async {
    await backend.setChain(enabled: account != nil, reset: false)
    let state = await backend.chainState()
    lastSyncAt = state.lastSyncAt.map { Date(timeIntervalSince1970: $0 / 1000) }
  }

  /// Starts a chain on `server` with this phone's library in it.
  func start(server: URL, backend: LocalBackend) async throws {
    guard try await ChainClient.isRelay(server) else { throw ChainError.notARelay }
    let code = ChainCode.format(ChainCode.newSecret())
    let keys = ChainKeys(code: code)!
    try await ChainClient(server: server, keys: keys).create()
    await adopt(ChainAccount(server: server, code: code, node: Self.newNode()), backend)
  }

  /// Joins the chain with this code; its library and this phone's merge.
  func join(server: URL, code typed: String, backend: LocalBackend) async throws {
    guard let code = ChainCode.normalize(typed), let keys = ChainKeys(code: code) else {
      throw ChainError.badCode
    }
    guard try await ChainClient.isRelay(server) else { throw ChainError.notARelay }
    _ = try await ChainClient(server: server, keys: keys).changes(since: 0, limit: 1)
    await adopt(ChainAccount(server: server, code: code, node: Self.newNode()), backend)
  }

  private func adopt(_ account: ChainAccount, _ backend: LocalBackend) async {
    await backend.setChain(enabled: true, reset: true)
    Keychain.setChain(account)
    self.account = account
    lastError = nil
    lastSyncAt = nil
  }

  /// Stops syncing here. The library stays on the phone.
  func leave(_ backend: LocalBackend) async {
    Keychain.setChain(nil)
    account = nil
    lastError = nil
    lastSyncAt = nil
    await backend.setChain(enabled: false, reset: true)
  }

  /// Removes the chain from the relay, for every device in it.
  func delete(_ backend: LocalBackend) async throws {
    guard let account, let keys = ChainKeys(code: account.code) else { return }
    do {
      try await ChainClient(server: account.server, keys: keys).delete()
    } catch ChainError.notFound {}
    await leave(backend)
  }

  /// One round. Nil when not in a chain or it failed (see `lastError`).
  func sync(_ backend: LocalBackend) async -> ChainSyncResult? {
    guard let account, let keys = ChainKeys(code: account.code), lastError != .ended else {
      return nil
    }
    syncing = true
    defer { syncing = false }
    do {
      let result = try await backend.syncChain(
        keys: keys, client: ChainClient(server: account.server, keys: keys), node: account.node)
      lastSyncAt = .now
      lastError = nil
      return result
    } catch ChainError.notFound {
      lastError = .ended
    } catch ChainError.network {
      lastError = .unreachable
    } catch {
      lastError = .other(Self.describe(error))
    }
    return nil
  }

  /// For background refresh, without the app's objects.
  static func syncSaved(_ backend: LocalBackend) async -> ChainSyncResult? {
    guard let account = Keychain.chain(), let keys = ChainKeys(code: account.code) else {
      return nil
    }
    await backend.setChain(enabled: true, reset: false)
    return try? await backend.syncChain(
      keys: keys, client: ChainClient(server: account.server, keys: keys), node: account.node)
  }

  static func describe(_ error: Error) -> String {
    switch error {
    case ChainError.notFound: String(localized: "There's no chain with this code.")
    case ChainError.notARelay: String(localized: "This server doesn't relay sync chains.")
    case ChainError.network: String(localized: "Couldn't reach the relay. Check your connection.")
    case ChainError.badCode:
      String(localized: "That code isn't complete or has a typo. It has 28 letters and digits.")
    case ChainError.server(_, let message): message
    default: error.localizedDescription
    }
  }

  #if DEBUG
    /// Debug builds only, for PERCH_DEV_LOCAL=fresh.
    func forgetForTesting() {
      account = nil
      lastError = nil
      lastSyncAt = nil
    }
  #endif

  /// A random clock id for this device, like the extension's.
  private static func newNode() -> String {
    (0..<6).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }
}
