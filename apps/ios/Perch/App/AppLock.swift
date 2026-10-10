import CryptoKit
import Foundation
import LocalAuthentication
import Observation

/// An optional PIN, with Face ID or Touch ID, in front of the app: like the
/// extension's lock, so someone picking up the phone can't open your reading.
/// It hides the screen; it doesn't encrypt the library on the phone. The PIN
/// is kept as a salted hash in the Keychain, on this device only, and isn't
/// synced.
@MainActor @Observable
final class AppLock {
  private(set) var isEnabled = false
  private(set) var isLocked = false
  /// Unlock with Face ID / Touch ID as well as the PIN.
  var useBiometrics: Bool {
    didSet { UserDefaults.standard.set(useBiometrics, forKey: Self.biometricsKey) }
  }
  /// How long the app may be in the background before it locks again.
  var grace: Grace {
    didSet { UserDefaults.standard.set(grace.rawValue, forKey: Self.graceKey) }
  }
  /// Wrong PINs in a row; after five, a pause before the next try.
  private(set) var failures = 0
  private(set) var blockedUntil: Date?

  enum Grace: Int, CaseIterable, Identifiable {
    case immediately = 0
    case oneMinute = 60
    case fiveMinutes = 300
    case fifteenMinutes = 900
    var id: Int { rawValue }
  }

  private var backgroundedAt: Date?
  private static let biometricsKey = "perch.lock.biometrics"
  private static let graceKey = "perch.lock.grace"

  init() {
    useBiometrics = UserDefaults.standard.object(forKey: Self.biometricsKey) as? Bool ?? true
    grace = Grace(rawValue: UserDefaults.standard.integer(forKey: Self.graceKey)) ?? .immediately
    isEnabled = Keychain.lockPin() != nil
    isLocked = isEnabled
  }

  // MARK: Setting it up

  static func isValid(_ pin: String) -> Bool {
    pin.count == 6 && pin.allSatisfy(\.isASCII) && pin.allSatisfy(\.isNumber)
  }

  func setPin(_ pin: String) {
    let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) }).base64EncodedString()
    Keychain.setLockPin(.init(salt: salt, hash: Self.hash(pin, salt: salt)))
    isEnabled = true
    isLocked = false
  }

  func turnOff() {
    Keychain.setLockPin(nil)
    isEnabled = false
    isLocked = false
  }

  // MARK: Unlocking

  func verify(_ pin: String) -> Bool {
    guard let stored = Keychain.lockPin() else { return true }
    if let blockedUntil, blockedUntil > .now { return false }
    if Self.hash(pin, salt: stored.salt) == stored.hash {
      failures = 0
      blockedUntil = nil
      return true
    }
    failures += 1
    if failures >= 5 { blockedUntil = .now.addingTimeInterval(30) }
    return false
  }

  func unlock(with pin: String) -> Bool {
    guard verify(pin) else { return false }
    isLocked = false
    return true
  }

  /// Face ID, Touch ID or Optic ID, whichever this device has; nil when none
  /// is set up.
  var biometry: LABiometryType? {
    let context = LAContext()
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else {
      return nil
    }
    return context.biometryType == .none ? nil : context.biometryType
  }

  func unlockWithBiometrics() async {
    guard isLocked, useBiometrics, biometry != nil else { return }
    let context = LAContext()
    context.localizedFallbackTitle = String(localized: "Enter PIN")
    let ok =
      (try? await context.evaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        localizedReason: String(localized: "Unlock Perch"))) ?? false
    if ok {
      failures = 0
      isLocked = false
    }
  }

  // MARK: Following the app in and out

  func didEnterBackground() {
    guard isEnabled, !isLocked else { return }
    backgroundedAt = .now
    if grace == .immediately { isLocked = true }
  }

  func willEnterForeground() {
    guard isEnabled, !isLocked, let backgroundedAt else { return }
    if Date.now.timeIntervalSince(backgroundedAt) >= TimeInterval(grace.rawValue) {
      isLocked = true
    }
    self.backgroundedAt = nil
  }

  private static func hash(_ pin: String, salt: String) -> String {
    Data(SHA256.hash(data: Data("\(salt):\(pin)".utf8))).base64EncodedString()
  }
}
