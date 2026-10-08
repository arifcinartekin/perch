import CryptoKit
import Foundation
import PerchKit
import WebKit

/// Article images on disk, so articles read offline keep their pictures. The
/// article view loads every image through `perch-image:` (ImageSchemeHandler),
/// which serves from here and fetches what's missing. Fetches carry no cookies.
actor ImageCache {
  static let shared = ImageCache()

  static let scheme = "perch-image"
  private static let maxBytes = 8 * 1024 * 1024
  private static let budget = 250 * 1024 * 1024

  private let directory = URL.cachesDirectory.appending(
    path: "PerchImages", directoryHint: .isDirectory)
  private let session: URLSession
  /// Same session, but never over cellular in Low Data Mode, for prefetching.
  private let backgroundSession: URLSession

  init() {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieAcceptPolicy = .never
    config.timeoutIntervalForRequest = 30
    session = URLSession(configuration: config)
    let quiet = config.copy() as! URLSessionConfiguration
    quiet.allowsConstrainedNetworkAccess = false
    backgroundSession = URLSession(configuration: quiet)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  /// `perch-image://i?u=<url>` for a remote image.
  static func proxied(_ url: URL) -> String {
    var parts = URLComponents()
    parts.scheme = scheme
    parts.host = "i"
    parts.queryItems = [URLQueryItem(name: "u", value: url.absoluteString)]
    return parts.string ?? ""
  }

  static func original(_ proxied: URL) -> URL? {
    URLComponents(url: proxied, resolvingAgainstBaseURL: false)?
      .queryItems?.first { $0.name == "u" }?.value.flatMap(URL.init(string:))
  }

  struct Entry: Sendable {
    var data: Data
    var mimeType: String
  }

  func image(for url: URL) async -> Entry? {
    if let cached = cached(url) { return cached }
    return await fetch(url, session: session)
  }

  /// Downloads images ahead of time; skips ones already here.
  func prefetch(_ urls: [URL]) async {
    for url in urls where !Task.isCancelled {
      if FileManager.default.fileExists(atPath: file(url).path) { continue }
      _ = await fetch(url, session: backgroundSession)
    }
  }

  func sizeOnDisk() -> Int {
    files().reduce(0) { $0 + $1.size }
  }

  func clear() {
    try? FileManager.default.removeItem(at: directory)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  /// Oldest first until the cache fits its budget.
  func trim() {
    var all = files().sorted { $0.date < $1.date }
    var total = all.reduce(0) { $0 + $1.size }
    while total > Self.budget, let oldest = all.first {
      try? FileManager.default.removeItem(at: oldest.url)
      total -= oldest.size
      all.removeFirst()
    }
  }

  // MARK: -

  private func file(_ url: URL) -> URL {
    let hash = SHA256.hash(data: Data(url.absoluteString.utf8))
      .map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: hash)
  }

  private func cached(_ url: URL) -> Entry? {
    guard let data = try? Data(contentsOf: file(url)), data.count > 2 else { return nil }
    return Entry(data: data, mimeType: Self.sniff(data))
  }

  private func fetch(_ url: URL, session: URLSession) async -> Entry? {
    guard url.scheme == "https" || url.scheme == "http" else { return nil }
    var req = URLRequest(url: url)
    req.setValue("image/*", forHTTPHeaderField: "Accept")
    guard let (data, response) = try? await session.data(for: req),
      let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
      data.count <= Self.maxBytes,
      (http.mimeType ?? "").hasPrefix("image/") || Self.sniff(data) != "application/octet-stream"
    else { return nil }
    try? data.write(to: file(url), options: .atomic)
    return Entry(data: data, mimeType: http.mimeType ?? Self.sniff(data))
  }

  private func files() -> [(url: URL, size: Int, date: Date)] {
    let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
    let urls =
      (try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: keys)) ?? []
    return urls.map { url in
      let values = try? url.resourceValues(forKeys: Set(keys))
      return (url, values?.fileSize ?? 0, values?.contentModificationDate ?? .distantPast)
    }
  }

  private static func sniff(_ data: Data) -> String {
    let b = [UInt8](data.prefix(12))
    if b.starts(with: [0xFF, 0xD8]) { return "image/jpeg" }
    if b.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
    if b.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
    if b.count >= 12, b[8...11] == [0x57, 0x45, 0x42, 0x50] { return "image/webp" }
    if b.count >= 12, b[4...7] == [0x66, 0x74, 0x79, 0x70] { return "image/avif" }
    if let head = String(data: data.prefix(256), encoding: .utf8), head.contains("<svg") {
      return "image/svg+xml"
    }
    return "application/octet-stream"
  }

  /// Image URLs in article HTML, resolved against the article's address.
  static func imageURLs(in html: String, base: URL?) -> [URL] {
    html.matches(of: /(?i)<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/).compactMap { m in
      URL(string: HTMLText.decodeEntities(String(m.1)), relativeTo: base)?.absoluteURL
    }
  }
}

/// Serves `perch-image:` requests from the image cache.
final class ImageSchemeHandler: NSObject, WKURLSchemeHandler {
  private var stopped = Set<ObjectIdentifier>()

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    let id = ObjectIdentifier(task)
    guard let url = task.request.url, let original = ImageCache.original(url) else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    Task { @MainActor in
      let entry = await ImageCache.shared.image(for: original)
      guard !stopped.contains(id) else {
        stopped.remove(id)
        return
      }
      guard let entry else {
        task.didFailWithError(URLError(.resourceUnavailable))
        return
      }
      task.didReceive(
        URLResponse(
          url: url, mimeType: entry.mimeType, expectedContentLength: entry.data.count,
          textEncodingName: nil))
      task.didReceive(entry.data)
      task.didFinish()
    }
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
    stopped.insert(ObjectIdentifier(task))
  }
}
