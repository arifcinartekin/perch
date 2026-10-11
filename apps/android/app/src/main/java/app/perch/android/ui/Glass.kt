@file:OptIn(ExperimentalHazeApi::class)

package app.perch.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.ExperimentalHazeApi
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.glass.GlassStyle
import dev.chrisbanes.haze.glass.hazeGlass
import dev.chrisbanes.haze.hazeSource

// Liquid-glass surfaces: floating bars and buttons that refract and blur what
// scrolls beneath them (Haze's glass material; Android 13+ gets the full
// optics, older versions a blur). Screens put their content in a GlassStage;
// anything drawn with Modifier.glass() on top of it samples that content.

/** The content glass surfaces on this screen sample. */
val LocalHaze = staticCompositionLocalOf<HazeState?> { null }

/**
 * The backdrop every screen sits on: the background colour with a soft
 * ember glow, like the app icon's, so glass has something to bend.
 */
@Composable
fun AppBackground(modifier: Modifier = Modifier) {
  val look = LocalLook.current
  Canvas(modifier.fillMaxSize()) {
    drawRect(look.background)
    drawCircle(
      Brush.radialGradient(
        listOf(look.accent.copy(alpha = if (look.dark) 0.16f else 0.10f), Color.Transparent),
        center = Offset(size.width * 0.85f, size.height * 0.08f),
        radius = size.maxDimension * 0.55f,
      ),
      radius = size.maxDimension * 0.55f,
      center = Offset(size.width * 0.85f, size.height * 0.08f),
    )
    drawCircle(
      Brush.radialGradient(
        listOf(look.accent.copy(alpha = if (look.dark) 0.07f else 0.05f), Color.Transparent),
        center = Offset(size.width * 0.1f, size.height * 0.9f),
        radius = size.maxDimension * 0.5f,
      ),
      radius = size.maxDimension * 0.5f,
      center = Offset(size.width * 0.1f, size.height * 0.9f),
    )
  }
}

/** Content (with the backdrop) that glass on top of it samples. */
@Composable
fun GlassSource(state: HazeState, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
  Box(modifier.fillMaxSize().hazeSource(state)) {
    AppBackground()
    content()
  }
}

/**
 * A glass surface in [shape]. With glass off in Settings it's a solid
 * surface in the palette's colours instead.
 */
@Composable
fun Modifier.glass(
  shape: RoundedCornerShape,
  interactionSource: MutableInteractionSource? = null,
): Modifier {
  val look = LocalLook.current
  val haze = LocalHaze.current
  val outline = this.border(0.5.dp, look.hairline, shape)
  if (!look.glass.enabled || haze == null) {
    return outline.clip(shape).background(look.solid)
  }
  val tint = look.solid.copy(alpha = look.surfaceOpacity() * 0.55f)
  val style = remember(shape, tint) {
    GlassStyle {
      shape(shape)
      tint(tint)
    }
  }
  return this.hazeGlass(HazeInput.Sources(haze), style = style, interactionSource = interactionSource)
}

/** A round glass button with an icon, for toolbars. */
@Composable
fun GlassIconButton(
  icon: ImageVector,
  contentDescription: String,
  modifier: Modifier = Modifier,
  size: Dp = 44.dp,
  tint: Color = LocalLook.current.text,
  onClick: () -> Unit,
) {
  val interaction = remember { MutableInteractionSource() }
  Box(
    modifier
      .size(size)
      .glass(RoundedCornerShape(size / 2), interaction)
      .clip(RoundedCornerShape(size / 2))
      .clickable(interaction, indication = null, role = Role.Button, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, contentDescription, tint = tint, modifier = Modifier.size(22.dp))
  }
}

/** A glass capsule holding several toolbar buttons side by side. */
@Composable
fun GlassCapsule(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
  Row(
    modifier.height(44.dp).glass(RoundedCornerShape(22.dp)).padding(horizontal = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
    content = content,
  )
}

/** One button inside a [GlassCapsule]. */
@Composable
fun CapsuleButton(
  icon: ImageVector,
  contentDescription: String,
  tint: Color = LocalLook.current.text,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  Box(
    Modifier
      .size(40.dp, 40.dp)
      .clip(RoundedCornerShape(20.dp))
      .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(
      icon, contentDescription, modifier = Modifier.size(21.dp),
      tint = if (enabled) tint else tint.copy(alpha = 0.35f),
    )
  }
}
