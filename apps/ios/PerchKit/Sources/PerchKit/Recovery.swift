import CryptoKit
import Foundation

/// Recovery codes, as in @perch/core/recovery: 20 characters of Crockford
/// base32 (100 bits) in groups of four. Made on the device at sign-up and
/// shown once; the server keeps only a hash.
public enum RecoveryCode {
  static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
  public static let length = 20

  public static func new() -> String {
    var bytes = [UInt8](repeating: 0, count: length)
    _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
    // 256 is a multiple of 32, so each byte mod 32 is unbiased.
    return format(String(bytes.map { alphabet[Int($0 % 32)] }))
  }

  static func format(_ raw: String) -> String {
    stride(from: 0, to: raw.count, by: 4).map { i in
      let start = raw.index(raw.startIndex, offsetBy: i)
      return String(raw[start..<raw.index(start, offsetBy: min(4, raw.count - i))])
    }.joined(separator: "-")
  }

  /// What someone typed, in canonical form; nil when it can't be a code.
  public static func normalize(_ input: String) -> String? {
    let s = input.uppercased()
      .filter { !$0.isWhitespace && $0 != "-" }
      .map { c -> Character in
        switch c {
        case "O": "0"
        case "I", "L": "1"
        default: c
        }
      }
    guard s.count == length, s.allSatisfy(alphabet.contains) else { return nil }
    return String(s)
  }
}

/// The sign-up proof of work, as in @perch/core/pow: a nonce whose
/// SHA-256(challenge + ":" + nonce) starts with `bits` zero bits.
public enum ProofOfWork {
  public static func leadingZeroBits<D: Sequence>(_ hash: D) -> Int where D.Element == UInt8 {
    var bits = 0
    for byte in hash {
      if byte == 0 {
        bits += 8
        continue
      }
      return bits + byte.leadingZeroBitCount
    }
    return bits
  }

  public static func solve(challenge: String, bits: Int) async throws -> String {
    try await Task.detached(priority: .userInitiated) {
      var n = 0
      while true {
        if n % 50_000 == 0 { try Task.checkCancellation() }
        let nonce = String(n, radix: 36)
        let hash = SHA256.hash(data: Data("\(challenge):\(nonce)".utf8))
        if leadingZeroBits(hash) >= bits { return nonce }
        n += 1
      }
    }.value
  }
}

/// Suggested usernames, as in @perch/core/username: two plain words and a
/// number, so nobody has to put their own name on a public profile.
public enum UsernameSuggestion {
  static let adjectives = [
    "quiet", "amber", "misty", "calm", "brisk", "gentle", "golden", "hidden", "lucky", "mellow",
    "nimble", "patient", "rustic", "silver", "sleepy", "steady", "sunny", "tidy", "wild", "windy",
    "bright", "cosy", "curious", "dusky", "early", "fuzzy", "hazel", "humble", "jolly", "little",
    "lofty", "merry", "olive", "plucky", "rapid", "shy", "snowy", "swift", "velvet", "wandering",
  ]
  static let nouns = [
    "heron", "finch", "wren", "robin", "owl", "sparrow", "swallow", "lark", "kestrel", "puffin",
    "otter", "badger", "fox", "hare", "lynx", "marten", "beaver", "seal", "moth", "beetle",
    "birch", "cedar", "fern", "maple", "willow", "pine", "reed", "moss", "brook", "cove",
    "dune", "glade", "harbor", "meadow", "pebble", "ridge", "tide", "valley", "reader", "page",
  ]

  public static func make() -> String {
    "\(adjectives.randomElement()!)_\(nouns.randomElement()!)\(Int.random(in: 10...99))"
  }
}
