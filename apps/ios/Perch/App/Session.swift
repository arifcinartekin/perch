import CryptoKit
import Foundation
import Observation
import PerchKit
import UIKit

/// Where the library lives. Without an account it's on this phone (the app
/// fetches the feeds itself); signed in to a Perch Server, it's the server's,
/// synced with the other clients. The server address and username live in
/// UserDefaults, the session token in the Keychain, and each account's
/// offline copy in its own folder.
@MainActor @Observable
final class Session {
  enum Phase: Equatable {
    case restoring
    /// No account: the library on this phone.
    case local
    case signedIn
  }

  private(set) var phase: Phase = .restoring
  private(set) var server: URL?
  private(set) var username: String?
  private(set) var user: PublicUser?
  /// The server, when signed in.
  private(set) var client: APIClient?
  private(set) var backend: (any ReaderBackend)?
  private(set) var store: OfflineStore?
  /// Sync without an account, for the library on this phone.
  let chain = ChainLink()

  /// The app's session, for background refresh to use the same library
  /// objects as the screens.
  static weak var current: Session?

  nonisolated private static let serverKey = "perch.server"
  nonisolated private static let usernameKey = "perch.username"

  init() {
    server = UserDefaults.standard.url(forKey: Self.serverKey)
    username = UserDefaults.standard.string(forKey: Self.usernameKey)
    Self.current = self
    Task { await restore() }
  }

  /// Picks up the saved session. Offline, you stay signed in and read what's
  /// on the phone; only a 401 signs you out.
  private func restore() async {
    #if DEBUG
      if devLocal() { return }
      if await devSignIn() { return }
    #endif
    guard let server, let username, let token = Keychain.token(for: server) else {
      openLocal()
      return
    }
    open(server: server, username: username, token: token)
    do {
      user = try await client?.me()
    } catch let error as APIError where error.isUnauthorized {
      forget()
    } catch {}
  }

  func signIn(server: URL, username: String, password: String) async throws {
    let res = try await APIClient(baseURL: server).login(
      username: username, password: password, deviceName: Self.deviceName)
    await adopt(server: server, res)
  }

  func register(server: URL, username: String, password: String, invite: String?) async throws {
    let res = try await APIClient(baseURL: server).register(
      username: username, password: password, invite: invite, deviceName: Self.deviceName)
    await adopt(server: server, res)
  }

  /// Signs out here and removes this account's offline copy from the phone;
  /// the library on the phone comes back.
  func signOut() async {
    try? await client?.logout()
    if let server, let username {
      try? FileManager.default.removeItem(at: Self.accountDirectory(server, username))
    }
    await ImageCache.shared.clear()
    forget()
  }

  /// Called when the server rejects our token mid-session.
  func sessionExpired() {
    forget()
  }

  /// Feeds added on the phone before signing in are subscribed on the server
  /// too, so nothing is lost.
  private func adopt(server: URL, _ res: AuthResponse) async {
    let client = APIClient(baseURL: server, token: res.token)
    if let local = backend as? LocalBackend, let library = try? await local.library(),
      !library.feeds.isEmpty
    {
      _ = try? await client.importOPML(OPML.build(library))
    }
    Keychain.setToken(res.token, for: server)
    UserDefaults.standard.set(server, forKey: Self.serverKey)
    UserDefaults.standard.set(res.user.username, forKey: Self.usernameKey)
    user = res.user
    Glance.clear()
    open(server: server, username: res.user.username, token: res.token)
  }

  private func open(server: URL, username: String, token: String) {
    self.server = server
    self.username = username
    guard
      let store = try? OfflineStore(
        url: Self.accountDirectory(server, username).appending(path: "offline.sqlite"))
    else {
      openLocal()
      return
    }
    let client = APIClient(baseURL: server, token: token)
    self.store = store
    self.client = client
    backend = client
    phase = .signedIn
  }

  /// The library on this phone.
  private func openLocal() {
    client = nil
    user = nil
    if let store = try? OfflineStore(url: Self.localLibrary) {
      let local = LocalBackend(store: store)
      self.store = store
      backend = local
      Task { await chain.prepare(local) }
    }
    phase = .local
  }

  private func forget() {
    if let server { Keychain.setToken(nil, for: server) }
    UserDefaults.standard.removeObject(forKey: Self.usernameKey)
    username = nil
    Glance.clear()
    openLocal()
  }

  /// The open library, for background refresh.
  var library: (backend: any ReaderBackend, store: OfflineStore)? {
    guard let backend, let store else { return nil }
    return (backend, store)
  }

  /// Application Support/Local/library.sqlite: the library without an account.
  nonisolated static var localLibrary: URL {
    URL.applicationSupportDirectory.appending(path: "Local/library.sqlite")
  }

  /// Application Support/Accounts/<hash of server and username>.
  nonisolated static func accountDirectory(_ server: URL, _ username: String) -> URL {
    let key = SHA256.hash(data: Data("\(server.absoluteString)|\(username)".utf8))
      .prefix(12).map { String(format: "%02x", $0) }.joined()
    return URL.applicationSupportDirectory.appending(
      path: "Accounts/\(key)", directoryHint: .isDirectory)
  }

  /// The signed-in account, or the library on the phone, for the background
  /// refresh task.
  nonisolated static func savedLibrary() -> (backend: any ReaderBackend, store: OfflineStore)? {
    let defaults = UserDefaults.standard
    if let server = defaults.url(forKey: serverKey),
      let username = defaults.string(forKey: usernameKey),
      let token = Keychain.token(for: server),
      let store = try? OfflineStore(
        url: accountDirectory(server, username).appending(path: "offline.sqlite"))
    {
      return (APIClient(baseURL: server, token: token), store)
    }
    guard let store = try? OfflineStore(url: localLibrary) else { return nil }
    return (LocalBackend(store: store), store)
  }

  #if DEBUG
    /// Debug builds only: PERCH_DEV_LOCAL=1 signs out and opens the library
    /// on the phone; =fresh empties it first and leaves any chain, like a new
    /// install.
    private func devLocal() -> Bool {
      guard let mode = ProcessInfo.processInfo.environment["PERCH_DEV_LOCAL"] else { return false }
      if let server { Keychain.setToken(nil, for: server) }
      if mode == "fresh" {
        try? FileManager.default.removeItem(at: Self.localLibrary.deletingLastPathComponent())
        Keychain.setChain(nil)
        chain.forgetForTesting()
      }
      openLocal()
      return true
    }

    /// Debug builds only: sign in from the launch environment, for screenshots
    /// and UI checks on the simulator (`SIMCTL_CHILD_PERCH_DEV_SERVER=…` with
    /// `xcrun simctl launch`). Goes through the normal sign-in, Argon2 included.
    private func devSignIn() async -> Bool {
      let env = ProcessInfo.processInfo.environment
      guard let address = env["PERCH_DEV_SERVER"], let url = APIClient.normalizeServerURL(address),
        let user = env["PERCH_DEV_USER"], let password = env["PERCH_DEV_PASSWORD"]
      else { return false }
      do {
        try await signIn(server: url, username: user, password: password)
        return true
      } catch {
        print("PERCH_DEV sign-in failed:", error)
        return false
      }
    }
  #endif

  /// Shown in the server's device list, e.g. "Perch on iPhone".
  private static var deviceName: String { "Perch on \(UIDevice.current.model)" }
}
