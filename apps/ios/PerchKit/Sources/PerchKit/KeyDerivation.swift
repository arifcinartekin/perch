import CArgon2
import CryptoKit
import Foundation

// Client-side password stretching, byte-for-byte the same as deriveKeys() in
// packages/core/src/auth.ts: Argon2id over the NFKC password with the account's
// salt, then HKDF-SHA256 (empty salt) into an auth key, which is all the server
// ever sees, and a master key reserved for the E2E vault.

public struct DerivedKeys: Sendable {
  /// Sent in place of the password (base64url, 32 bytes).
  public var authKey: String
  /// Never leaves the device.
  public var masterKey: Data
}

public enum KeyDerivationError: Error, LocalizedError {
  case badSalt
  case unsupportedParameters
  case argon2(Int32)

  public var errorDescription: String? {
    switch self {
    case .badSalt: "The server sent an invalid salt."
    case .unsupportedParameters:
      "The server asked for key-derivation settings Perch doesn't accept."
    case .argon2(let code):
      "Key derivation failed (\(String(cString: argon2_error_message(code))))."
    }
  }
}

public enum KeyDerivation {
  /// Runs Argon2id (~0.5 s at the default 64 MiB) off the calling actor.
  public static func derive(password: String, salt: String, params: KdfParams) async throws
    -> DerivedKeys
  {
    try await Task.detached(priority: .userInitiated) {
      try deriveSync(password: password, salt: salt, params: params)
    }.value
  }

  public static func deriveSync(password: String, salt: String, params: KdfParams) throws
    -> DerivedKeys
  {
    guard params.isValid else { throw KeyDerivationError.unsupportedParameters }
    guard let saltBytes = Data(base64URL: salt), saltBytes.count >= 8 else {
      throw KeyDerivationError.badSalt
    }
    let pwd = Data(password.precomposedStringWithCompatibilityMapping.utf8)
    var stretched = [UInt8](repeating: 0, count: 32)

    let status = pwd.withUnsafeBytes { p in
      saltBytes.withUnsafeBytes { s in
        argon2id_hash_raw(
          UInt32(params.iterations), UInt32(params.memory), UInt32(params.parallelism),
          p.baseAddress, p.count, s.baseAddress, s.count, &stretched, stretched.count)
      }
    }
    guard status == ARGON2_OK.rawValue else { throw KeyDerivationError.argon2(status) }

    let ikm = SymmetricKey(data: stretched)
    let auth = hkdf(ikm, info: "perch/auth/v1")
    let master = hkdf(ikm, info: "perch/master/v1")
    return DerivedKeys(authKey: auth.base64URLEncoded(), masterKey: master)
  }

  private static func hkdf(_ ikm: SymmetricKey, info: String) -> Data {
    let key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: ikm, salt: Data(), info: Data(info.utf8), outputByteCount: 32)
    return key.withUnsafeBytes { Data($0) }
  }

  /// A fresh 16-byte salt for a new account (newSalt() in core).
  public static func newSalt() -> String {
    var bytes = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64URLEncoded()
  }
}

extension Data {
  public init?(base64URL: String) {
    var s = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    while s.count % 4 != 0 { s += "=" }
    self.init(base64Encoded: s)
  }

  public func base64URLEncoded() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
