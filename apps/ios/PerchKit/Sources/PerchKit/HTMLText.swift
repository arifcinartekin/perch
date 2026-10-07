import Foundation

/// Plain text from feed HTML, for list previews (htmlToText in
/// packages/core/src/parser/text.ts). Cheap enough to run per row.
public enum HTMLText {
  public static func plain(_ html: String, limit: Int = 280) -> String {
    var s = html
    // Drop whole elements whose text isn't content.
    s = s.replacing(/(?is)<(script|style|noscript|template)\b.*?<\/\1\s*>/, with: " ")
    s = s.replacing(/<[^>]*>/, with: " ")
    s = decodeEntities(s)
    s = s.replacing(/\s+/, with: " ").trimmingCharacters(in: .whitespaces)
    if s.count > limit { s = String(s.prefix(limit)).trimmingCharacters(in: .whitespaces) + "…" }
    return s
  }

  private static let named: [String: String] = [
    "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ", "ndash": "–",
    "mdash": "—", "hellip": "…", "lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”",
    "laquo": "«", "raquo": "»", "copy": "©", "reg": "®", "trade": "™", "middot": "·",
    "bull": "•", "eacute": "é", "uuml": "ü", "ouml": "ö", "ccedil": "ç",
  ]

  public static func decodeEntities(_ text: String) -> String {
    guard text.contains("&") else { return text }
    return text.replacing(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/) { match in
      let body = String(match.1)
      if body.hasPrefix("#") {
        let digits = body.dropFirst()
        let code =
          digits.first == "x" || digits.first == "X"
          ? UInt32(digits.dropFirst(), radix: 16) : UInt32(digits, radix: 10)
        if let code, let scalar = Unicode.Scalar(code) { return String(Character(scalar)) }
        return String(match.0)
      }
      return named[body] ?? String(match.0)
    }
  }
}
