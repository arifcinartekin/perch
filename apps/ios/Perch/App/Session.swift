import Foundation
import Observation
import PerchKit
import UIKit

/// Which server we talk to and who is signed in. The server address lives in
/// UserDefaults, the session token in the Keychain.
@MainActor @Observable
final class Session {
  enum Phase: Equatable {
    case restoring
    case signedOut
    case signedIn
  }

  private(set) var phase: Phase = .restoring
  private(set) var server: URL?
  private(set) var user: PublicUser?
  private(set) var client: APIClient?

  private static let serverKey = "perch.server"

  init() {
    server = UserDefaults.standard.url(forKey: Self.serverKey)
    Task { await restore() }
  }

  /// Picks up the saved session. A network failure keeps you signed in (the
  /// server may just be unreachable right now); only a 401 signs you out.
  private func restore() async {
    #if DEBUG
      if await devSignIn() { return }
    #endif
    guard let server, let token = Keychain.token(for: server) else {
      phase = .signedOut
      return
    }
    let client = APIClient(baseURL: server, token: token)
    self.client = client
    phase = .signedIn
    do {
      user = try await client.me()
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

  func signOut() async {
    try? await client?.logout()
    forget()
  }

  /// Called when the server rejects our token mid-session.
  func sessionExpired() {
    forget()
  }

  private func adopt(server: URL, _ res: AuthResponse) {
    Keychain.setToken(res.token, for: server)
    UserDefaults.standard.set(server, forKey: Self.serverKey)
    self.server = server
    user = res.user
    client = APIClient(baseURL: server, token: res.token)
    phase = .signedIn
  }

  private func forget() {
    if let server { Keychain.setToken(nil, for: server) }
    client = nil
    user = nil
    phase = .signedOut
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
