import CryptoKit
import Foundation
import Observation
import PerchKit
import UIKit

/// Which server we talk to and who is signed in. The server address and
/// username live in UserDefaults, the session token in the Keychain, and each
/// account's offline copy in its own folder.
@MainActor @Observable
final class Session {
  enum Phase: Equatable {
    case restoring
    case signedOut
    case signedIn
  }

  private(set) var phase: Phase = .restoring
  private(set) var server: URL?
  private(set) var username: String?
  private(set) var user: PublicUser?
  private(set) var client: APIClient?
  private(set) var store: OfflineStore?

  nonisolated private static let serverKey = "perch.server"
  nonisolated private static let usernameKey = "perch.username"

  init() {
    server = UserDefaults.standard.url(forKey: Self.serverKey)
    username = UserDefaults.standard.string(forKey: Self.usernameKey)
    Task { await restore() }
  }

  /// Picks up the saved session. Offline, you stay signed in and read what's
  /// on the phone; only a 401 signs you out.
  private func restore() async {
    #if DEBUG
      if await devSignIn() { return }
    #endif
    guard let server, let username, let token = Keychain.token(for: server) else {
      phase = .signedOut
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
    adopt(server: server, res)
  }

  func register(server: URL, username: String, password: String, invite: String?) async throws {
    let res = try await APIClient(baseURL: server).register(
      username: username, password: password, invite: invite, deviceName: Self.deviceName)
    adopt(server: server, res)
  }

  /// Signs out here and removes this account's offline copy from the phone.
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

  private func adopt(server: URL, _ res: AuthResponse) {
    Keychain.setToken(res.token, for: server)
    UserDefaults.standard.set(server, forKey: Self.serverKey)
    UserDefaults.standard.set(res.user.username, forKey: Self.usernameKey)
    user = res.user
    open(server: server, username: res.user.username, token: res.token)
  }

  private func open(server: URL, username: String, token: String) {
    self.server = server
    self.username = username
    store = try? OfflineStore(
      url: Self.accountDirectory(server, username).appending(path: "offline.sqlite"))
    client = APIClient(baseURL: server, token: token)
    phase = store == nil ? .signedOut : .signedIn
  }

  private func forget() {
    if let server { Keychain.setToken(nil, for: server) }
    client = nil
    store = nil
    user = nil
    phase = .signedOut
  }

  /// Application Support/Accounts/<hash of server and username>.
  nonisolated static func accountDirectory(_ server: URL, _ username: String) -> URL {
    let key = SHA256.hash(data: Data("\(server.absoluteString)|\(username)".utf8))
      .prefix(12).map { String(format: "%02x", $0) }.joined()
    return URL.applicationSupportDirectory.appending(
      path: "Accounts/\(key)", directoryHint: .isDirectory)
  }

  /// The signed-in account, for the background refresh task.
  nonisolated static func savedAccount() -> (client: APIClient, store: OfflineStore)? {
    let defaults = UserDefaults.standard
    guard let server = defaults.url(forKey: serverKey),
      let username = defaults.string(forKey: usernameKey),
      let token = Keychain.token(for: server),
      let store = try? OfflineStore(
        url: accountDirectory(server, username).appending(path: "offline.sqlite"))
    else { return nil }
    return (APIClient(baseURL: server, token: token), store)
  }

  #if DEBUG
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
