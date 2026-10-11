package app.perch.android.core

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlinx.serialization.Serializable

// Perch's palette and the user's colour customisation: a port of
// packages/core/src/theme.ts (via the iPhone app's Theme.swift), so a colour
// picked in the extension looks the same here. Colours are "#rrggbb".

enum class ColorMode { LIGHT, DARK }

@Serializable
data class ColorOverrides(
  val background: String? = null,
  val text: String? = null,
  val accent: String? = null,
  val button: String? = null,
) {
  val isEmpty: Boolean
    get() = listOf(background, text, accent, button).all { Theme.normalizeHex(it) == null }
}

@Serializable
data class Appearance(
  val light: ColorOverrides = ColorOverrides(),
  val dark: ColorOverrides = ColorOverrides(),
) {
  operator fun get(mode: ColorMode) = if (mode == ColorMode.LIGHT) light else dark
}

/** The glass look (GlassSettings in core). */
@Serializable
data class GlassSettings(
  val enabled: Boolean = true,
  /** 0 solid … 50 the default look … 100 twice as see-through. */
  val transparency: Double = 50.0,
  /** Blur behind panels, 0–40 px. */
  val blur: Double = 24.0,
) {
  /** How much more see-through than the default (1); 0 = solid. */
  val clarity: Double get() = if (enabled) transparency.coerceIn(0.0, 100.0) / 50 else 0.0
}

/** Every colour a screen needs, resolved for one mode. */
data class Palette(
  val scheme: ColorMode,
  val background: String,
  val solid: String,
  val text: String,
  val textMuted: String,
  val textFaint: String,
  val accent: String,
  val accentContrast: String,
  val accentText: String,
  val button: String,
  val buttonContrast: String,
  val glassClear: Double,
)

object Theme {
  const val EMBER = "#ff7a1a"
  const val INK = "#12151c"
  const val CREAM = "#f4f1ea"

  private data class Base(
    val bg: String, val solid: String, val text: String, val muted: String, val faint: String,
    val accentText: String, val glassClear: Double,
  )

  private val base = mapOf(
    ColorMode.LIGHT to Base("#f7f5f0", "#ffffff", INK, "#555a66", "#9a9da6", "#b35512", 0.42),
    ColorMode.DARK to Base("#0e1118", "#161a24", CREAM, "#b8b4aa", "#7d7a73", EMBER, 0.48),
  )

  /** The palette for a mode after the user's overrides (buildThemeVars in core). */
  fun palette(mode: ColorMode, overrides: ColorOverrides = ColorOverrides()): Palette {
    val d = base.getValue(mode)
    if (overrides.isEmpty) {
      return Palette(mode, d.bg, d.solid, d.text, d.muted, d.faint, EMBER, INK, d.accentText, EMBER, INK, d.glassClear)
    }
    val customBackground = normalizeHex(overrides.background)
    val background = customBackground ?: d.bg
    val scheme = if (customBackground != null) (if (isDark(background)) ColorMode.DARK else ColorMode.LIGHT) else mode
    val b = base.getValue(scheme)
    val customText = normalizeHex(overrides.text)
    val text = customText ?: b.text
    val accent = normalizeHex(overrides.accent) ?: EMBER
    val button = normalizeHex(overrides.button) ?: EMBER
    val solid = if (scheme == ColorMode.DARK) mix(background, "#ffffff", 0.06) else mix(background, "#ffffff", 0.7)
    return Palette(
      scheme, background, solid, text,
      if (customText != null) mix(text, background, 0.35) else b.muted,
      if (customText != null) mix(text, background, 0.6) else b.faint,
      accent, contrastText(accent), readableOn(accent, background), button, contrastText(button),
      b.glassClear,
    )
  }

  /** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; null when invalid. */
  fun normalizeHex(value: String?): String? {
    var s = value?.trim()?.lowercase() ?: return null
    if (s.startsWith("#")) s = s.drop(1)
    if (!(s.length == 3 || s.length == 6) || !s.all { it in "0123456789abcdef" }) return null
    if (s.length == 3) s = s.map { "$it$it" }.joinToString("")
    return "#$s"
  }

  fun rgb(hex: String): Triple<Double, Double, Double> {
    val n = hex.drop(1).toLong(16)
    return Triple(((n shr 16) and 255).toDouble(), ((n shr 8) and 255).toDouble(), (n and 255).toDouble())
  }

  fun argb(hex: String): Long = 0xFF000000 or hex.drop(1).toLong(16)

  private fun toHex(r: Double, g: Double, b: Double) =
    "#%02x%02x%02x".format(r.roundToInt(), g.roundToInt(), b.roundToInt())

  /** WCAG relative luminance. */
  fun luminance(hex: String): Double {
    val (r, g, b) = rgb(hex)
    fun channel(v: Double): Double {
      val c = v / 255
      return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  fun isDark(hex: String) = luminance(hex) < 0.179
  fun contrastText(hex: String) = if (isDark(hex)) "#fafafa" else INK

  fun contrastRatio(a: String, b: String): Double {
    val la = luminance(a)
    val lb = luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
  }

  /** [color] nudged toward black or white until it reads on [background]. */
  fun readableOn(color: String, background: String, ratio: Double = 4.5): String {
    val target = if (isDark(background)) "#ffffff" else "#000000"
    var t = 0.0
    while (t <= 1) {
      val candidate = mix(color, target, t)
      if (contrastRatio(candidate, background) >= ratio) return candidate
      t += 0.05
    }
    return target
  }

  fun mix(a: String, b: String, t: Double): String {
    val (ar, ag, ab) = rgb(a)
    val (br, bg, bb) = rgb(b)
    return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
  }

  /** Swatches offered next to the colour pickers (the same as the web's). */
  val accentPresets = listOf(EMBER, "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#22c55e", "#14b8a6")
  val backgroundPresets = mapOf(
    ColorMode.DARK to listOf("#0e1118", "#000000", "#0a0a0b", "#111827", "#1e1e2e", "#002b36", "#282828"),
    ColorMode.LIGHT to listOf("#f7f5f0", "#ffffff", "#f5f5f6", "#fdf6e3", "#eff1f5", "#eef2f7"),
  )
}
