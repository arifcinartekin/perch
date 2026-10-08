import PerchKit
import SwiftUI
import UIKit

/// The logo's colours, for places that don't follow the user's palette (the
/// connect screen before any settings exist).
enum Brand {
  static let ember = Color(hex: 0xFF7A1A)
  static let ink = Color(hex: 0x12151C)
}

/// The look in effect: the user's palette for the current mode, the glass
/// setting, the reading font and this device's wallpaper. Built from the
/// synced settings (Theme.palette is a port of core/theme.ts) and handed down
/// the view tree.
struct AppTheme: Equatable {
  var palette: Palette
  var glass: GlassSettings
  var serif: Bool
  var wallpaper: Wallpaper?

  struct Wallpaper: Equatable {
    var image: UIImage
    /// Background-colour overlay, 0–0.9.
    var dim: Double
    /// Blur radius in points.
    var blur: Double
  }

  static let `default` = AppTheme(
    palette: Theme.palette(.light), glass: .default, serif: false, wallpaper: nil)

  var background: Color { Color(hex: palette.background) }
  var solid: Color { Color(hex: palette.solid) }
  var text: Color { Color(hex: palette.text) }
  var muted: Color { Color(hex: palette.textMuted) }
  var faint: Color { Color(hex: palette.textFaint) }
  var accent: Color { Color(hex: palette.accent) }
  var accentText: Color { Color(hex: palette.accentText) }
  var accentContrast: Color { Color(hex: palette.accentContrast) }
  var button: Color { Color(hex: palette.button) }
  var buttonContrast: Color { Color(hex: palette.buttonContrast) }
  var colorScheme: ColorScheme { palette.scheme == .dark ? .dark : .light }

  /// The opacity of a surface's solid tint: 1 when glass is off, less as the
  /// user turns transparency up. `clear` is how see-through the surface is at
  /// the default setting.
  func surfaceOpacity(clear: Double) -> Double {
    guard glass.enabled else { return 1 }
    return min(1, max(0, 1 - clear * glass.clarity))
  }

  /// The system blur closest to the blur setting.
  var material: Material {
    switch glass.normalized.blur {
    case ..<8: .ultraThinMaterial
    case ..<18: .thinMaterial
    case ..<30: .regularMaterial
    default: .thickMaterial
    }
  }

  static func == (a: AppTheme, b: AppTheme) -> Bool {
    a.palette == b.palette && a.glass == b.glass && a.serif == b.serif
      && a.wallpaper?.image === b.wallpaper?.image && a.wallpaper?.dim == b.wallpaper?.dim
      && a.wallpaper?.blur == b.wallpaper?.blur
  }
}

extension EnvironmentValues {
  @Entry var theme: AppTheme = .default
}

/// The backdrop behind every screen: the wallpaper if this device has one,
/// else the background with the ember glow, and the night gradient in dark.
struct Backdrop: View {
  @Environment(\.theme) private var theme

  var body: some View {
    ZStack {
      if theme.palette.scheme == .dark {
        LinearGradient(
          colors: [
            Color(hex: Theme.mix(theme.palette.background, "#ffffff", 0.06)),
            Color(hex: Theme.mix(theme.palette.background, "#000000", 0.3)),
          ], startPoint: .top, endPoint: .bottom)
      } else {
        theme.background
      }
      if let wallpaper = theme.wallpaper {
        GeometryReader { geo in
          Image(uiImage: wallpaper.image)
            .resizable()
            .scaledToFill()
            .frame(width: geo.size.width, height: geo.size.height)
            .blur(radius: wallpaper.blur)
            .clipped()
        }
        theme.background.opacity(wallpaper.dim)
      } else {
        RadialGradient(
          colors: [theme.accent.opacity(theme.palette.scheme == .dark ? 0.22 : 0.2), .clear],
          center: .topTrailing, startRadius: 0, endRadius: 520)
        RadialGradient(
          colors: [theme.text.opacity(0.05), .clear],
          center: .bottomLeading, startRadius: 0, endRadius: 420)
      }
    }
    .ignoresSafeArea()
  }
}

/// A frosted panel (list rows, cards, the reading surface): the system blur
/// plus the palette's solid colour, as see-through as the glass setting says.
struct Surface: View {
  @Environment(\.theme) private var theme
  /// How see-through at the default setting; rows a little more than the
  /// reading surface.
  var clear: Double? = nil
  var shape: AnyShape = AnyShape(Rectangle())

  var body: some View {
    let opacity = theme.surfaceOpacity(clear: clear ?? theme.palette.glassClear)
    ZStack {
      if opacity < 1 { shape.fill(theme.material) }
      shape.fill(theme.solid.opacity(opacity))
    }
  }
}

extension View {
  /// Puts the backdrop behind a screen and lets lists show it through.
  func perchBackdrop() -> some View {
    scrollContentBackground(.hidden).background { Backdrop() }
  }

  /// A list row on a glass surface.
  func surfaceRow() -> some View {
    listRowBackground(Surface())
  }
}

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255, opacity: opacity)
  }

  /// "#rrggbb" from the palette.
  init(hex: String) {
    let (r, g, b) = Theme.rgb(Theme.normalizeHex(hex) ?? "#000000")
    self.init(.sRGB, red: r / 255, green: g / 255, blue: b / 255)
  }

  /// "#rrggbb", for saving a colour the user picked.
  var hexString: String {
    let ui = UIColor(self)
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    ui.getRed(&r, green: &g, blue: &b, alpha: nil)
    func channel(_ v: CGFloat) -> Int { Int((min(1, max(0, v)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", channel(r), channel(g), channel(b))
  }
}
