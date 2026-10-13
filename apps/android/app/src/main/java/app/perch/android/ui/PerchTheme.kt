package app.perch.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import app.perch.android.core.ColorMode
import app.perch.android.core.GlassSettings
import app.perch.android.core.Palette
import app.perch.android.core.SyncedSettings
import app.perch.android.core.Theme

/**
 * The look in effect: the user's palette for the current mode (the same
 * colours as the extension and the iPhone app), the glass setting and the
 * reading font.
 */
@Immutable
data class PerchLook(
  val palette: Palette,
  val glass: GlassSettings,
  val serif: Boolean,
  val wallpaper: Wallpaper? = null,
) {
  /** This phone's background picture, with the background colour over it ([dim], 0–0.9) and a blur in dp. */
  @Immutable
  data class Wallpaper(val image: ImageBitmap, val dim: Float, val blur: Float)

  val dark: Boolean get() = palette.scheme == ColorMode.DARK
  val background: Color get() = palette.background.color
  val solid: Color get() = palette.solid.color
  val text: Color get() = palette.text.color
  val muted: Color get() = palette.textMuted.color
  val faint: Color get() = palette.textFaint.color
  val accent: Color get() = palette.accent.color
  val accentText: Color get() = palette.accentText.color
  val accentContrast: Color get() = palette.accentContrast.color
  val button: Color get() = palette.button.color
  val buttonContrast: Color get() = palette.buttonContrast.color
  val hairline: Color get() = if (dark) Color.White.copy(alpha = 0.10f) else Color.Black.copy(alpha = 0.08f)

  /** How opaque a glass surface's tint is: 1 when glass is off, less as transparency goes up. */
  fun surfaceOpacity(clear: Double = palette.glassClear): Float =
    if (!glass.enabled) 1f else (1 - clear * glass.clarity).coerceIn(0.0, 1.0).toFloat()
}

val String.color: Color get() = Color(Theme.argb(this))

val LocalLook = staticCompositionLocalOf { PerchLook(Theme.palette(ColorMode.LIGHT), GlassSettings(), false) }

@Composable
fun PerchTheme(settings: SyncedSettings, wallpaper: PerchLook.Wallpaper? = null, content: @Composable () -> Unit) {
  val systemDark = isSystemInDarkTheme()
  val mode = when (settings.theme) {
    "light" -> ColorMode.LIGHT
    "dark" -> ColorMode.DARK
    else -> if (systemDark) ColorMode.DARK else ColorMode.LIGHT
  }
  val look = remember(settings, mode, wallpaper) {
    val overrides = settings.appearance?.get(mode) ?: app.perch.android.core.ColorOverrides()
    PerchLook(Theme.palette(mode, overrides), settings.glass ?: GlassSettings(), settings.readingFont == "serif", wallpaper)
  }
  val colors = if (look.dark) {
    darkColorScheme(
      primary = look.accent, onPrimary = look.accentContrast, background = look.background,
      onBackground = look.text, surface = look.solid, onSurface = look.text,
      surfaceVariant = look.solid, onSurfaceVariant = look.muted, outline = look.hairline,
      surfaceContainerHigh = look.solid, surfaceContainerLow = look.solid, surfaceContainer = look.solid,
    )
  } else {
    lightColorScheme(
      primary = look.accent, onPrimary = look.accentContrast, background = look.background,
      onBackground = look.text, surface = look.solid, onSurface = look.text,
      surfaceVariant = look.solid, onSurfaceVariant = look.muted, outline = look.hairline,
      surfaceContainerHigh = look.solid, surfaceContainerLow = look.solid, surfaceContainer = look.solid,
    )
  }
  CompositionLocalProvider(LocalLook provides look) {
    MaterialTheme(colorScheme = colors, content = content)
  }
}
