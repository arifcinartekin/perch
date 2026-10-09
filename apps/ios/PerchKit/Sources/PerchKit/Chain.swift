import CryptoKit
import Foundation

// Sync chains: sync without an account, through a relay that can't read what
// it passes on. A port of packages/core/src/chain.ts (the code, the keys and
// the record format must match it byte for byte; ChainTests pins the shared
// vectors). The engine that merges records into the library on this phone is
// LocalBackend+Chain.swift.

public enum ChainCode {
  /// The relay a new chain uses unless you pick another.
  public static let defaultServer = URL(string: "https://sync.perch.ws")!

  private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
  private static let secretBytes = 16
  private static let length = 28

  public static func newSecret() -> Data {
    SymmetricKey(size: .bits128).withUnsafeBytes { Data($0) }
  }

  /// CRC-8, polynomial 0x07.
  private static func crc8(_ bytes: Data) -> UInt8 {
    var crc: UInt8 = 0
    for b in bytes {
      crc ^= b
      for _ in 0..<8 { crc = crc & 0x80 != 0 ? (crc << 1) ^ 0x07 : crc << 1 }
    }
    return crc
  }

  /// "7GQ2-M4XD-…": seven groups of four, Crockford base 32.
  public static func format(_ secret: Data) -> String {
    precondition(secret.count == secretBytes, "A chain secret is 16 bytes")
    var bytes = secret
    bytes.append(crc8(secret))
    var out = ""
    var value = 0
    var bits = 0
    for b in bytes {
      value = (value << 8) | Int(b)
      bits += 8
      while bits >= 5 {
        out.append(alphabet[(value >> (bits - 5)) & 31])
        bits -= 5
      }
      value &= (1 << bits) - 1
    }
    if bits > 0 { out.append(alphabet[(value << (5 - bits)) & 31]) }
    return stride(from: 0, to: out.count, by: 4).map { i in
      let start = out.index(out.startIndex, offsetBy: i)
      return String(out[start..<out.index(start, offsetBy: 4)])
    }.joined(separator: "-")
  }

  /// The secret in a code as typed (any case, dashes and spaces optional, O
  /// read as 0 and I or L as 1), or nil if it isn't a whole, valid code.
  public static func parse(_ input: String) -> Data? {
    var clean = ""
    for ch in input.uppercased() where !ch.isWhitespace && ch != "-" {
      switch ch {
      case "O": clean.append("0")
      case "I", "L": clean.append("1")
      default: clean.append(ch)
      }
    }
    guard clean.count == length else { return nil }
    var bytes = Data()
    var value = 0
    var bits = 0
    for ch in clean {
      guard let v = alphabet.firstIndex(of: ch) else { return nil }
      value = (value << 5) | v
      bits += 5
      if bits >= 8 {
        bytes.append(UInt8((value >> (bits - 8)) & 0xff))
        bits -= 8
      }
      value &= (1 << bits) - 1
    }
    guard value == 0, bytes.count == secretBytes + 1 else { return nil }
    let secret = bytes.prefix(secretBytes)
    return crc8(Data(secret)) == bytes.last ? Data(secret) : nil
  }

  public static func normalize(_ input: String) -> String? {
    parse(input).map(format)
  }

  /// perch://chain?server=…&code=… — what the QR code holds.
  public static func link(server: URL, code: String) -> URL {
    var parts = URLComponents()
    parts.scheme = "perch"
    parts.host = "chain"
    parts.queryItems = [
      URLQueryItem(name: "server", value: server.absoluteString),
      URLQueryItem(name: "code", value: code),
    ]
    return parts.url!
  }

  public static func parseLink(_ url: URL) -> (server: URL, code: String)? {
    guard url.scheme == "perch", url.host == "chain",
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
      let code = items.first(where: { $0.name == "code" })?.value.flatMap(normalize)
    else { return nil }
    let server = items.first(where: { $0.name == "server" })?.value.flatMap(URL.init(string:))
    if let server, server.scheme != "https", server.scheme != "http" { return nil }
    return (server ?? defaultServer, code)
  }
}

// MARK: - Keys and records

/// A sync record, as in packages/core/src/sync.ts, with its data kept as JSON.
public struct ChainSyncRecord: Sendable, Equatable {
  public var type: String
  public var id: String
  /// Nil on tombstones.
  public var data: JSONValue?
  public var hlc: String
  public var deleted: Bool
  /// The relay's version; 0 for a record going out.
  public var version: Int

  public init(
    type: String, id: String, data: JSONValue?, hlc: String, deleted: Bool = false,
    version: Int = 0
  ) {
    self.type = type
    self.id = id
    self.data = data
    self.hlc = hlc
    self.deleted = deleted
    self.version = version
  }

  public var key: String { "\(type):\(id)" }
}

/// A record as the relay stores it.
public struct ChainRecord: Codable, Sendable, Equatable {
  public var key: String
  public var hlc: String
  public var deleted: Bool
  public var ephemeral: Bool
  public var blob: String
  public var version: Int

  enum CodingKeys: String, CodingKey { case key, hlc, deleted, ephemeral, blob, version }

  public init(
    key: String, hlc: String, deleted: Bool, ephemeral: Bool, blob: String, version: Int = 0
  ) {
    self.key = key
    self.hlc = hlc
    self.deleted = deleted
    self.ephemeral = ephemeral
    self.blob = blob
    self.version = version
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    key = try c.decode(String.self, forKey: .key)
    hlc = try c.decode(String.self, forKey: .hlc)
    deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
    ephemeral = try c.decodeIfPresent(Bool.self, forKey: .ephemeral) ?? false
    blob = try c.decode(String.self, forKey: .blob)
    version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 0
  }

  /// As the relay expects a push: false flags and the version left out.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(key, forKey: .key)
    try c.encode(hlc, forKey: .hlc)
    if deleted { try c.encode(true, forKey: .deleted) }
    if ephemeral { try c.encode(true, forKey: .ephemeral) }
    try c.encode(blob, forKey: .blob)
  }
}

public struct ChainKeys: Sendable {
  /// Bearer token for the relay (base64url, 32 bytes).
  public let token: String
  let enc: SymmetricKey
  let mac: SymmetricKey

  private static let salt = Data("perch-chain-v1".utf8)

  public init(secret: Data) {
    func derive(_ info: String) -> SymmetricKey {
      HKDF<SHA256>.deriveKey(
        inputKeyMaterial: SymmetricKey(data: secret), salt: Self.salt, info: Data(info.utf8),
        outputByteCount: 32)
    }
    token = derive("perch/chain/token/v1").withUnsafeBytes { Data($0) }.base64URLEncoded()
    enc = derive("perch/chain/enc/v1")
    mac = derive("perch/chain/mac/v1")
  }

  public init?(code: String) {
    guard let secret = ChainCode.parse(code) else { return nil }
    self.init(secret: secret)
  }

  /// base64url of the first 16 bytes of HMAC(mac, "type:id").
  public func slot(type: String, id: String) -> String {
    let mac = HMAC<SHA256>.authenticationCode(for: Data("\(type):\(id)".utf8), using: mac)
    return Data(mac).prefix(16).base64URLEncoded()
  }

  private static func additionalData(_ key: String, _ hlc: String, _ deleted: Bool) -> Data {
    Data("\(key)\n\(hlc)\n\(deleted ? 1 : 0)".utf8)
  }

  /// `iv` is for tests; normally random.
  public func seal(_ record: ChainSyncRecord, iv: Data? = nil) throws -> ChainRecord {
    let key = slot(type: record.type, id: record.id)
    var body: [String: JSONValue] = ["type": .string(record.type), "id": .string(record.id)]
    if !record.deleted, let data = record.data { body["data"] = data }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let plain = try encoder.encode(JSONValue.object(body))
    let nonce = try iv.map(AES.GCM.Nonce.init(data:)) ?? AES.GCM.Nonce()
    let box = try AES.GCM.seal(
      plain, using: enc, nonce: nonce,
      authenticating: Self.additionalData(key, record.hlc, record.deleted))
    var ephemeral = false
    if record.type == "state", !record.deleted, case .object(let d)? = record.data {
      ephemeral = d["read"] == .bool(true) && d["starred"] != .bool(true)
    }
    return ChainRecord(
      key: key, hlc: record.hlc, deleted: record.deleted, ephemeral: ephemeral,
      blob: box.combined!.base64URLEncoded())
  }

  /// The record inside, or nil when it doesn't decrypt or isn't in its slot.
  public func open(_ stored: ChainRecord) -> ChainSyncRecord? {
    guard let bytes = Data(base64URL: stored.blob), bytes.count > 28,
      let box = try? AES.GCM.SealedBox(combined: bytes),
      let plain = try? AES.GCM.open(
        box, using: enc,
        authenticating: Self.additionalData(stored.key, stored.hlc, stored.deleted)),
      case .object(let body)? = try? JSONDecoder().decode(JSONValue.self, from: plain),
      case .string(let type)? = body["type"], case .string(let id)? = body["id"],
      ["feed", "category", "setting", "state"].contains(type),
      slot(type: type, id: id) == stored.key
    else { return nil }
    let data = stored.deleted ? nil : body["data"]
    if !stored.deleted {
      guard case .object? = data else { return nil }
    }
    return ChainSyncRecord(
      type: type, id: id, data: data, hlc: stored.hlc, deleted: stored.deleted,
      version: stored.version)
  }
}

// MARK: - JSON values

/// Any JSON value, for record data the phone passes along without a model
/// for every field.
public enum JSONValue: Codable, Sendable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let b = try? c.decode(Bool.self) {
      self = .bool(b)
    } else if let n = try? c.decode(Double.self) {
      self = .number(n)
    } else if let s = try? c.decode(String.self) {
      self = .string(s)
    } else if let a = try? c.decode([JSONValue].self) {
      self = .array(a)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }

  /// Any Encodable as JSON.
  public init<T: Encodable>(encoding value: T) throws {
    self = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
  }

  public func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
  }

  public subscript(key: String) -> JSONValue? {
    if case .object(let o) = self { o[key] } else { nil }
  }

  public var string: String? { if case .string(let s) = self { s } else { nil } }
  public var number: Double? { if case .number(let n) = self { n } else { nil } }
  public var bool: Bool? { if case .bool(let b) = self { b } else { nil } }

  /// Sorted keys and fixed number formatting, so equal values compare equal.
  public var canonical: String {
    switch self {
    case .null: return "null"
    case .bool(let b): return b ? "true" : "false"
    case .number(let n):
      return n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
    case .string(let s):
      let data = try? JSONEncoder().encode(s)
      return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    case .array(let a): return "[" + a.map(\.canonical).joined(separator: ",") + "]"
    case .object(let o):
      return "{"
        + o.sorted { $0.key < $1.key }
        .map { JSONValue.string($0.key).canonical + ":" + $0.value.canonical }
        .joined(separator: ",") + "}"
    }
  }
}

// MARK: - Clock

/// Hybrid logical clock, as in packages/core/src/sync.ts:
/// "<13-digit ms>-<4-char base-36 counter>-<node>", ordered as plain strings.
public struct HybridClock: Sendable {
  public let node: String
  private var ms: Int64 = 0
  private var counter = 0
  private static let counterMax = 36 * 36 * 36 * 36 - 1

  public init(node: String) { self.node = node }

  private static var wall: Int64 { Int64(Date.now.timeIntervalSince1970 * 1000) }

  public static func format(ms: Int64, counter: Int, node: String) -> String {
    let m = String(ms)
    let c = String(counter, radix: 36)
    return String(repeating: "0", count: max(0, 13 - m.count)) + m + "-"
      + String(repeating: "0", count: max(0, 4 - c.count)) + c + "-" + node
  }

  static func parse(_ hlc: String) -> (ms: Int64, counter: Int)? {
    let parts = hlc.split(separator: "-", maxSplits: 2)
    guard parts.count == 3, parts[0].count == 13, parts[1].count == 4,
      let ms = Int64(parts[0]), let counter = Int(parts[1], radix: 36)
    else { return nil }
    return (ms, counter)
  }

  /// A timestamp for a change made here.
  public mutating func now() -> String {
    let wall = Self.wall
    if wall > ms {
      ms = wall
      counter = 0
    } else {
      bump()
    }
    return Self.format(ms: ms, counter: counter, node: node)
  }

  /// Folds in a timestamp seen from another device.
  public mutating func receive(_ remote: String) {
    guard let r = Self.parse(remote) else { return }
    let top = max(Self.wall, ms, r.ms)
    if top == ms && top == r.ms {
      counter = max(counter, r.counter)
      bump()
    } else if top == ms {
      bump()
    } else if top == r.ms {
      ms = top
      counter = r.counter
      bump()
    } else {
      ms = top
      counter = 0
    }
  }

  private mutating func bump() {
    if counter >= Self.counterMax {
      ms += 1
      counter = 0
    } else {
      counter += 1
    }
  }
}

// MARK: - Relay

/// Errors from a chain relay.
public enum ChainError: Error, Equatable, Sendable {
  /// The relay has no chain with this code (never started, or deleted).
  case notFound
  /// The server doesn't relay chains.
  case notARelay
  case network
  case server(Int, String)
  case badCode
}

/// /api/v1/chain on a Perch Server, for one chain.
public struct ChainClient: Sendable {
  public let server: URL
  let token: String
  private let session: URLSession

  public struct Page: Decodable, Sendable {
    public var records: [ChainRecord]
    public var cursor: Int
    public var more: Bool
  }

  public struct PushResult: Decodable, Sendable {
    public struct Item: Decodable, Sendable {
      public var key: String
      public var status: String
      public var version: Int?
    }
    public var results: [Item]
    public var cursor: Int
  }

  public init(server: URL, keys: ChainKeys, session: URLSession = .shared) {
    self.server = server
    self.token = keys.token
    self.session = session
  }

  /// Whether the server at this address relays chains.
  public static func isRelay(_ server: URL, session: URLSession = .shared) async throws -> Bool {
    let info = try await APIClient(baseURL: server, session: session).serverInfo()
    return info.chain == true
  }

  /// Creates the chain, or confirms it exists. Returns whether it was new.
  @discardableResult
  public func create() async throws -> Bool {
    struct Created: Decodable { var created: Bool }
    let res: Created = try await call("", method: "POST", body: Data("{}".utf8))
    return res.created
  }

  public func changes(since: Int, limit: Int = 500) async throws -> Page {
    try await call("/changes?since=\(since)&limit=\(limit)")
  }

  public func push(_ records: [ChainRecord]) async throws -> PushResult {
    struct Body: Encodable { var records: [ChainRecord] }
    return try await call(
      "/push", method: "POST", body: try JSONEncoder().encode(Body(records: records)))
  }

  /// Removes the chain from the relay, for every device in it.
  public func delete() async throws {
    let _: Empty = try await call("", method: "DELETE")
  }

  private struct Empty: Decodable {}

  private struct Problem: Decodable {
    var error: String
    var message: String?
  }

  private func call<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil)
    async throws -> T
  {
    var req = URLRequest(url: URL(string: server.absoluteString + "/api/v1/chain" + path)!)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.cachePolicy = .reloadIgnoringLocalCacheData
    if let body {
      req.httpBody = body
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: req)
    } catch {
      throw ChainError.network
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let problem = try? JSONDecoder().decode(Problem.self, from: data)
      switch problem?.error {
      case "chain-not-found": throw ChainError.notFound
      case "chain-off": throw ChainError.notARelay
      default:
        if status == 404 { throw ChainError.notARelay }
        throw ChainError.server(status, problem?.message ?? "The server answered \(status)")
      }
    }
    if status == 204 || data.isEmpty, let empty = Empty() as? T { return empty }
    return try JSONDecoder().decode(T.self, from: data)
  }
}
