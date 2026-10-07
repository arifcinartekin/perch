import SwiftUI
import UIKit

/// Perch's palette (BRAND in packages/core/src/theme.ts) and the backdrop the
/// glass sits on. The system draws the Liquid Glass itself; we give it the
/// same ember glow on night/cream that the extension and web reader use.
enum Brand {
  static let ember = Color(hex: 0xFF7A1A)
  static let ink = Color(hex: 0x12151C)
  static let cream = Color(hex: 0xF4F1EA)
  static let nightTop = Color(hex: 0x1B2030)
  static let nightBottom = Color(hex: 0x0A0C12)

  /// The page background: #f7f5f0 light, #0e1118 dark.
  static let background = Color(light: 0xF7F5F0, dark: 0x0E1118)
  /// Ember as text: darkened on light backgrounds to stay readable (4.6:1).
  static let accentText = Color(light: 0xB35512, dark: 0xFF7A1A)
  static let secondaryText = Color(light: 0x555A66, dark: 0xB8B4AA)
}

/// The backdrop behind every screen: an ember glow in the top corner over the
/// background, and the app icon's night gradient in dark mode.
struct Backdrop: View {
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    ZStack {
      if scheme == .dark {
        LinearGradient(
          colors: [Color(hex: 0x1A1E28), Color(hex: 0x0A0C11)], startPoint: .top,
          endPoint: .bottom)
      } else {
        Brand.background
      }
      RadialGradient(
        colors: [Brand.ember.opacity(scheme == .dark ? 0.22 : 0.20), .clear],
        center: .topTrailing, startRadius: 0, endRadius: 520)
      RadialGradient(
        colors: [Brand.ember.opacity(scheme == .dark ? 0.06 : 0.05), .clear],
        center: .bottomLeading, startRadius: 0, endRadius: 420)
    }
    .ignoresSafeArea()
  }
}

extension View {
  /// Puts the backdrop behind a screen and lets lists show it through.
  func perchBackdrop() -> some View {
    scrollContentBackground(.hidden).background { Backdrop() }
  }
}

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255, opacity: opacity)
  }

  init(light: UInt32, dark: UInt32) {
    self.init(
      uiColor: UIColor { traits in
        UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
      })
  }
}
