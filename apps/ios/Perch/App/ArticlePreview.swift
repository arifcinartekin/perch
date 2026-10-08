import Foundation
import ImageIO
import PerchKit
import UIKit

/// What a list row shows besides the title: a line or two of text and the
/// article's first real picture. Worked out once per article, since rows are
/// drawn again and again while scrolling.
struct ArticlePreview {
  var text: String
  var image: URL?

  @MainActor private static var cache: [String: ArticlePreview] = [:]

  @MainActor static func of(_ article: Article) -> ArticlePreview {
    if let hit = cache[article.id] { return hit }
    if cache.count > 3000 { cache.removeAll(keepingCapacity: true) }
    let preview = make(article)
    cache[article.id] = preview
    return preview
  }

  static func make(_ article: Article) -> ArticlePreview {
    let html = article.summaryHtml ?? article.contentHtml ?? ""
    let base = article.url.flatMap(URL.init(string:))
    return ArticlePreview(
      text: text(html, title: article.displayTitle),
      image: image(article, base: base))
  }

  /// Plain text without bare links and link-aggregator boilerplate ("Article
  /// URL: … Comments URL: … Points: 12"), so a summary that is only that shows
  /// nothing rather than noise.
  static func text(_ html: String, title: String) -> String {
    var s = HTMLText.plain(html, limit: 400)
    // Some feeds repeat the title as the summary's first line.
    if s.hasPrefix(title) { s = String(s.dropFirst(title.count)) }
    s = s.replacing(/https?:\/\/\S+/, with: " ")
    s = s.replacing(/(?i)(article url|comments url|points|# comments)\s*:\s*\d*/, with: " ")
    s = s.replacing(/\s+/, with: " ").trimmingCharacters(in: .whitespaces)
    let letters = s.unicodeScalars.filter(CharacterSet.letters.contains).count
    if letters < 25 || s == title { return "" }
    return s
  }

  /// An image enclosure, else the first `<img>` that isn't a tracking pixel
  /// or an icon.
  static func image(_ article: Article, base: URL?) -> URL? {
    if let enclosure = article.enclosures.first(where: { $0.type?.hasPrefix("image/") == true }),
      let url = URL(string: enclosure.url, relativeTo: base)?.absoluteURL, isWeb(url)
    {
      return url
    }
    let html = (article.contentHtml ?? "") + (article.summaryHtml ?? "")
    for tag in html.matches(of: /(?i)<img\b[^>]*>/) {
      let tag = String(tag.0)
      if let size = tag.firstMatch(of: /(?i)\s(?:width|height)\s*=\s*["']?(\d+)/),
        let n = Int(size.1), n < 40
      {
        continue
      }
      guard let src = tag.firstMatch(of: /(?i)\ssrc\s*=\s*["']([^"']+)["']/),
        let url = URL(string: HTMLText.decodeEntities(String(src.1)), relativeTo: base)?
          .absoluteURL, isWeb(url)
      else { continue }
      let path = url.absoluteString.lowercased()
      if path.contains("pixel") || path.contains("feedburner") || path.contains("emoji")
        || path.hasSuffix(".svg")
      {
        continue
      }
      return url
    }
    return nil
  }

  private static func isWeb(_ url: URL) -> Bool {
    url.scheme == "https" || url.scheme == "http"
  }
}

/// Small decoded copies of list thumbnails, from the image cache (so they
/// show offline too).
@MainActor
enum Thumbnails {
  private static let memory: NSCache<NSURL, UIImage> = {
    let cache = NSCache<NSURL, UIImage>()
    cache.countLimit = 300
    return cache
  }()

  static func cached(_ url: URL) -> UIImage? { memory.object(forKey: url as NSURL) }

  static func load(_ url: URL, pixels: Int) async -> UIImage? {
    if let hit = cached(url) { return hit }
    guard let entry = await ImageCache.shared.image(for: url) else { return nil }
    let image = await Task.detached(priority: .utility) {
      downsample(entry.data, pixels: pixels)
    }.value
    if let image { memory.setObject(image, forKey: url as NSURL) }
    return image
  }

  nonisolated private static func downsample(_ data: Data, pixels: Int) -> UIImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: pixels,
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return nil }
    // Skip images that turned out to be icons or spacers.
    guard cg.width >= 48, cg.height >= 48 else { return nil }
    return UIImage(cgImage: cg)
  }
}
