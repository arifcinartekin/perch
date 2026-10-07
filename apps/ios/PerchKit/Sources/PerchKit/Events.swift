import Foundation

/// What `/sync/events` reports: the account's sync cursor moved (library, read
/// state or settings changed somewhere) or the server stored new articles.
public enum ServerEvent: Sendable, Equatable {
  case cursor(String)
  case articles
}

extension APIClient {
  /// The server-sent event stream. Ends when the connection drops; callers
  /// reconnect (see Reader.listen in the app).
  public func events() -> AsyncThrowingStream<ServerEvent, Error> {
    let url = baseURL.appending(path: "api/v1/sync/events")
    var req = URLRequest(url: url)
    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    req.timeoutInterval = 3600
    if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    let request = req

    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          let (bytes, response) = try await URLSession.shared.bytes(for: request)
          let status = (response as? HTTPURLResponse)?.statusCode ?? 0
          guard status == 200 else {
            throw APIError(status: status, code: "http-\(status)", message: "Event stream refused")
          }
          var parser = EventStreamParser()
          for try await line in bytes.lines {
            if let event = parser.feed(line) { continuation.yield(event) }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}

/// A minimal text/event-stream parser for the two events Perch sends. Each of
/// them carries exactly one `data:` line, so an event completes on its data
/// line: AsyncBytes.lines drops the blank lines that normally end an event.
struct EventStreamParser {
  private var name = "message"

  /// Feeds one line; returns an event when it completes one.
  mutating func feed(_ line: String) -> ServerEvent? {
    if line.isEmpty {
      name = "message"
      return nil
    }
    if line.hasPrefix(":") { return nil }
    let field: Substring
    var value: Substring = ""
    if let i = line.firstIndex(of: ":") {
      field = line[..<i]
      value = line[line.index(after: i)...]
      if value.hasPrefix(" ") { value = value.dropFirst() }
    } else {
      field = line[...]
    }
    switch field {
    case "event":
      name = String(value)
      return nil
    case "data":
      defer { name = "message" }
      switch name {
      case "cursor": return .cursor(String(value))
      case "articles": return .articles
      default: return nil
      }
    default:
      return nil
    }
  }
}
