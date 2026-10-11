package app.perch.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The Perch mark (brand/src), in the palette's text and accent colours. */
@Composable
fun PerchMark(size: Dp = 30.dp, modifier: Modifier = Modifier) {
  val look = LocalLook.current
  val image = remember(look.text, look.accent, look.background) {
    markVector(body = look.text, accent = look.accent, eye = look.background)
  }
  Image(image, contentDescription = "Perch", modifier = modifier.size(size))
}

private fun markVector(body: Color, accent: Color, eye: Color): ImageVector =
  ImageVector.Builder("perch", 30.dp, 30.dp, viewportWidth = 420f, viewportHeight = 420f).apply {
    // The mark's drawing spans x 50–466, y 80–466 of its 512 grid.
    addGroup(translationX = -48f, translationY = -62f)
    fun fill(d: String, color: Color) = addPath(addPathNodes(d), fill = SolidColor(color))
    fun stroke(d: String, color: Color, width: Float) =
      addPath(addPathNodes(d), stroke = SolidColor(color), strokeLineWidth = width, strokeLineCap = StrokeCap.Round)
    fill("M362,132 L462,168 L372,192 Z", accent)
    fill(
      "M392,176 C392,120 352,84 304,84 C252,84 214,118 208,164 C150,188 96,250 56,330 L172,336 " +
        "C188,388 232,416 284,416 C350,416 400,366 404,296 C406,262 394,236 380,222 C388,210 392,194 392,176 Z",
      body,
    )
    stroke("M214,266 A64,64 0 0 1 278,330", accent, 15f)
    stroke("M214,216 A114,114 0 0 1 328,330", accent, 15f)
    fill("M200,330 A14,14 0 1,0 228,330 A14,14 0 1,0 200,330 Z", accent)
    fill("M328,150 A10,10 0 1,0 348,150 A10,10 0 1,0 328,150 Z", eye)
    stroke("M262,410 L262,440", body, 10f)
    stroke("M312,410 L312,440", body, 10f)
    fill("M109,436 L423,436 A13,13 0 0 1 423,462 L109,462 A13,13 0 0 1 109,436 Z", accent)
    clearGroup()
  }.build()
