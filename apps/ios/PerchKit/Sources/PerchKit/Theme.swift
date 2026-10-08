import Foundation

// Perch's palette and the user's colour customisation: a port of
// packages/core/src/theme.ts, so a colour picked in the extension looks the
// same on the phone. Colours are lowercase "#rrggbb" strings; the app turns
// them into SwiftUI colours.

public enum ColorMode: String, Codable, Sendable, CaseIterable { case light, dark }

/// User colour overrides for one theme mode. Unset fields use the defaults.
public struct ColorOverrides: Codable, Sendable, Equatable, Hashable {
  public var background: String?
  public var text: String?
  public var accent: String?
  public var button: String?

  public init(
    background: String? = nil, text: String? = nil, accent: String? = nil, button: String? = nil
  ) {
    self.background = background
    self.text = text
    self.accent = accent
    self.button = button
  }

  public var isEmpty: Bool {
    Theme.normalizeHex(background) == nil && Theme.normalizeHex(text) == nil
      && Theme.normalizeHex(accent) == nil && Theme.normalizeHex(button) == nil
  }

  public init(from decoder: Decoder) throws {
    // Junk from a newer or broken client reads as "default", not a failure.
    let c = try decoder.container(keyedBy: CodingKeys.self)
    func hex(_ key: CodingKeys) -> String? {
      Theme.normalizeHex((try? c.decodeIfPresent(String.self, forKey: key)) ?? nil)
    }
    background = hex(.background)
    text = hex(.text)
    accent = hex(.accent)
    button = hex(.button)
  }
}

/// Custom colours, kept separately for the light and the dark theme.
public struct Appearance: Codable, Sendable, Equatable, Hashable {
  public var light: ColorOverrides
  public var dark: ColorOverrides

  public init(light: ColorOverrides = .init(), dark: ColorOverrides = .init()) {
    self.light = light
    self.dark = dark
  }

  public subscript(mode: ColorMode) -> ColorOverrides {
    get { mode == .light ? light : dark }
    set {
      if mode == .light { light = newValue } else { dark = newValue }
    }
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    light = (try? c.decodeIfPresent(ColorOverrides.self, forKey: .light)) ?? .init()
    dark = (try? c.decodeIfPresent(ColorOverrides.self, forKey: .dark)) ?? .init()
  }
}

/// The frosted-glass look (GlassSettings in core).
public struct GlassSettings: Codable, Sendable, Equatable, Hashable {
  public var enabled: Bool
  /// 0 solid … 50 the default look … 100 twice as see-through.
  public var transparency: Double
  /// Blur behind panels, 0–40 px.
  public var blur: Double

  public init(enabled: Bool = true, transparency: Double = 50, blur: Double = 24) {
    self.enabled = enabled
    self.transparency = transparency
    self.blur = blur
  }

  public static let `default` = GlassSettings()
  public static let maxBlur: Double = 40

  /// Clamped, like normalizeGlass in core.
  public var normalized: GlassSettings {
    GlassSettings(
      enabled: enabled, transparency: min(100, max(0, transparency.rounded())),
      blur: min(Self.maxBlur, max(0, blur.rounded())))
  }

  /// How much more see-through than the default (1), 0 = solid.
  public var clarity: Double { enabled ? normalized.transparency / 50 : 0 }
}

/// Every colour a screen needs, resolved for one mode.
public struct Palette: Sendable, Equatable {
  public var scheme: ColorMode
  public var background: String
  /// Cards, rows and the reading surface under the glass tint.
  public var solid: String
  public var text: String
  public var textMuted: String
  public var textFaint: String
  public var accent: String
  /// Text on an accent fill.
  public var accentContrast: String
  /// The accent as a readable text colour on the background (links).
  public var accentText: String
  public var button: String
  public var buttonContrast: String
  /// How see-through glass surfaces are at the default setting (0.42 / 0.48).
  public var glassClear: Double
}

public enum Theme {
  public static let ember = "#ff7a1a"
  public static let ink = "#12151c"
  public static let cream = "#f4f1ea"

  struct Base {
    var bg, solid, text, muted, faint, accentText: String
    var glassClear: Double
  }

  static let base: [ColorMode: Base] = [
    .light: Base(
      bg: "#f7f5f0", solid: "#ffffff", text: ink, muted: "#555a66", faint: "#9a9da6",
      accentText: "#b35512", glassClear: 0.42),
    .dark: Base(
      bg: "#0e1118", solid: "#161a24", text: cream, muted: "#b8b4aa", faint: "#7d7a73",
      accentText: ember, glassClear: 0.48),
  ]

  /// The palette for a mode after the user's overrides (buildThemeVars in core;
  /// with no overrides, the stylesheet defaults).
  public static func palette(_ mode: ColorMode, _ overrides: ColorOverrides = .init()) -> Palette {
    let defaults = base[mode]!
    if overrides.isEmpty {
      return Palette(
        scheme: mode, background: defaults.bg, solid: defaults.solid, text: defaults.text,
        textMuted: defaults.muted, textFaint: defaults.faint, accent: ember, accentContrast: ink,
        accentText: defaults.accentText, button: ember, buttonContrast: ink,
        glassClear: defaults.glassClear)
    }
    let customBackground = normalizeHex(overrides.background)
    let background = customBackground ?? defaults.bg
    let scheme: ColorMode =
      customBackground != nil ? (isDark(background) ? .dark : .light) : mode
    let b = base[scheme]!
    let customText = normalizeHex(overrides.text)
    let text = customText ?? b.text
    let accent = normalizeHex(overrides.accent) ?? ember
    let button = normalizeHex(overrides.button) ?? ember
    let solid = scheme == .dark ? mix(background, "#ffffff", 0.06) : mix(background, "#ffffff", 0.7)
    return Palette(
      scheme: scheme, background: background, solid: solid, text: text,
      textMuted: customText != nil ? mix(text, background, 0.35) : b.muted,
      textFaint: customText != nil ? mix(text, background, 0.6) : b.faint,
      accent: accent, accentContrast: contrastText(accent),
      accentText: readableOn(accent, background), button: button,
      buttonContrast: contrastText(button), glassClear: b.glassClear)
  }

  /// `#abc`, `abc`, `#AABBCC` → `#aabbcc`; nil when invalid.
  public static func normalizeHex(_ value: String?) -> String? {
    guard var s = value?.trimmingCharacters(in: .whitespaces).lowercased() else { return nil }
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 3 || s.count == 6, s.allSatisfy(\.isHexDigit) else { return nil }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    return "#" + s
  }

  public static func rgb(_ hex: String) -> (r: Double, g: Double, b: Double) {
    let n = UInt32(hex.dropFirst(), radix: 16) ?? 0
    return (Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255))
  }

  static func toHex(_ r: Double, _ g: Double, _ b: Double) -> String {
    String(
      format: "#%02x%02x%02x", Int(r.rounded(.toNearestOrAwayFromZero)),
      Int(g.rounded(.toNearestOrAwayFromZero)), Int(b.rounded(.toNearestOrAwayFromZero)))
  }

  /// WCAG relative luminance.
  public static func luminance(_ hex: String) -> Double {
    let (r, g, b) = rgb(hex)
    func channel(_ v: Double) -> Double {
      let c = v / 255
      return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  public static func isDark(_ hex: String) -> Bool { luminance(hex) < 0.179 }

  public static func contrastText(_ hex: String) -> String { isDark(hex) ? "#fafafa" : ink }

  public static func contrastRatio(_ a: String, _ b: String) -> Double {
    let (la, lb) = (luminance(a), luminance(b))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }

  /// `color` nudged toward black or white until it reads on `background`.
  public static func readableOn(_ color: String, _ background: String, ratio: Double = 4.5)
    -> String
  {
    let target = isDark(background) ? "#ffffff" : "#000000"
    var t = 0.0
    while t <= 1 {
      let candidate = mix(color, target, t)
      if contrastRatio(candidate, background) >= ratio { return candidate }
      t += 0.05
    }
    return target
  }

  public static func mix(_ a: String, _ b: String, _ t: Double) -> String {
    let (ar, ag, ab) = rgb(a)
    let (br, bg, bb) = rgb(b)
    return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
  }

  /// Swatches offered next to the colour pickers (the same as the web's).
  public static let accentPresets = [
    ember, "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#22c55e", "#14b8a6",
  ]
  public static let backgroundPresets: [ColorMode: [String]] = [
    .dark: ["#0e1118", "#000000", "#0a0a0b", "#111827", "#1e1e2e", "#002b36", "#282828"],
    .light: ["#f7f5f0", "#ffffff", "#f5f5f6", "#fdf6e3", "#eff1f5", "#eef2f7"],
  ]
  public static let textPresets: [ColorMode: [String]] = [
    .dark: ["#f4f1ea", "#ffffff", "#e7e7ea", "#d4d4d8", "#cdd6f4", "#93a1a1", "#a9b1d6"],
    .light: ["#12151c", "#000000", "#18181b", "#3f3f46", "#433422", "#4c4f69"],
  ]
}
