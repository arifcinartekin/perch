import Foundation
import Observation
import UIKit

/// Settings that stay on this phone, like the PIN and wallpaper in the
/// extension: offline reading, list pictures, text size and the wallpaper.
/// Kept in UserDefaults; the wallpaper image itself is a file.
@MainActor @Observable
final class DeviceSettings {
  static let shared = DeviceSettings()
  private let defaults = UserDefaults.standard

  /// Keep recent unread and starred articles on the phone.
  var offlineEnabled: Bool {
    didSet { defaults.set(offlineEnabled, forKey: "offline.enabled") }
  }
  /// Also download their images (skipped in Low Data Mode).
  var offlineImages: Bool {
    didSet { defaults.set(offlineImages, forKey: "offline.images") }
  }
  /// How many articles to keep, newest first (starred ones are always kept).
  var offlineLimit: Int {
    didSet { defaults.set(offlineLimit, forKey: "offline.limit") }
  }

  /// Pictures next to articles in lists.
  var listImages: Bool {
    didSet { defaults.set(listImages, forKey: "list.images") }
  }

  /// Article text size in points, and its line height as a multiple.
  var readerTextSize: Double {
    didSet { defaults.set(readerTextSize, forKey: "reader.size") }
  }
  var readerLineHeight: Double {
    didSet { defaults.set(readerLineHeight, forKey: "reader.leading") }
  }

  var wallpaperDim: Double {
    didSet { defaults.set(wallpaperDim, forKey: "wallpaper.dim") }
  }
  var wallpaperBlur: Double {
    didSet { defaults.set(wallpaperBlur, forKey: "wallpaper.blur") }
  }
  private(set) var wallpaper: UIImage?

  static let offlineLimits = [100, 300, 1000, 3000]

  private init() {
    defaults.register(defaults: [
      "offline.enabled": true, "offline.images": true, "offline.limit": 300, "list.images": true,
      "reader.size": 17.0, "reader.leading": 1.6,
      "wallpaper.dim": 0.35, "wallpaper.blur": 0.0,
    ])
    offlineEnabled = defaults.bool(forKey: "offline.enabled")
    offlineImages = defaults.bool(forKey: "offline.images")
    offlineLimit = defaults.integer(forKey: "offline.limit")
    listImages = defaults.bool(forKey: "list.images")
    readerTextSize = defaults.double(forKey: "reader.size")
    readerLineHeight = defaults.double(forKey: "reader.leading")
    wallpaperDim = defaults.double(forKey: "wallpaper.dim")
    wallpaperBlur = defaults.double(forKey: "wallpaper.blur")
    wallpaper = UIImage(contentsOfFile: Self.wallpaperURL.path)
  }

  private static var wallpaperURL: URL {
    URL.applicationSupportDirectory.appending(path: "wallpaper.jpg")
  }

  /// Stores a picked photo, scaled down so it stays light in memory.
  func setWallpaper(_ data: Data) throws {
    guard let image = UIImage(data: data) else { throw WallpaperError.unreadable }
    let longest = max(image.size.width, image.size.height)
    let scale = min(1, 2400 / longest)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let scaled = UIGraphicsImageRenderer(size: size).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let jpeg = scaled.jpegData(compressionQuality: 0.85) else {
      throw WallpaperError.unreadable
    }
    try FileManager.default.createDirectory(
      at: Self.wallpaperURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try jpeg.write(to: Self.wallpaperURL, options: [.atomic, .completeFileProtection])
    wallpaper = scaled
  }

  func removeWallpaper() {
    try? FileManager.default.removeItem(at: Self.wallpaperURL)
    wallpaper = nil
  }

  enum WallpaperError: LocalizedError {
    case unreadable
    var errorDescription: String? { String(localized: "Perch couldn't read that image.") }
  }
}
