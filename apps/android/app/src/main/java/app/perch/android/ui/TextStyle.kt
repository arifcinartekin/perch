package app.perch.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.TextDecrease
import androidx.compose.material.icons.rounded.TextIncrease
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.DeviceSettings
import app.perch.android.R
import app.perch.android.Reader
import kotlinx.coroutines.launch

/** The article's font (synced), text size and line spacing (this phone only), as on the iPhone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TextStyleSheet(reader: Reader, onDismiss: () -> Unit) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  val settings by reader.settings.collectAsState()
  val size by reader.device.textSize.collectAsState()
  val spacing by reader.device.lineHeight.collectAsState()
  val sizes = DeviceSettings.TEXT_SIZES
  ModalBottomSheet(onDismissRequest = onDismiss, containerColor = look.solid) {
    Column(
      Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 20.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Choice(
        listOf("sans" to stringResource(R.string.font_sans), "serif" to stringResource(R.string.font_serif)),
        settings.readingFont ?: "sans",
      ) { v -> scope.launch { reader.saveSettings { it.copy(readingFont = v) } } }
      Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton({ reader.device.setTextSize(size - 1) }, enabled = size > sizes.start) {
          Icon(Icons.Rounded.TextDecrease, stringResource(R.string.smaller), tint = look.text)
        }
        Slider(
          value = size, valueRange = sizes, steps = (sizes.endInclusive - sizes.start).toInt() - 1,
          onValueChange = { reader.device.setTextSize(Math.round(it).toFloat()) },
          colors = SliderDefaults.colors(thumbColor = look.accent, activeTrackColor = look.accent),
          modifier = Modifier.weight(1f),
        )
        IconButton({ reader.device.setTextSize(size + 1) }, enabled = size < sizes.endInclusive) {
          Icon(Icons.Rounded.TextIncrease, stringResource(R.string.larger), tint = look.text)
        }
      }
      Text(
        stringResource(R.string.line_spacing), color = look.muted, fontSize = 13.sp,
        modifier = Modifier.padding(horizontal = 16.dp),
      )
      Choice(
        DeviceSettings.LINE_HEIGHTS.zip(
          listOf(stringResource(R.string.spacing_tight), stringResource(R.string.spacing_normal), stringResource(R.string.spacing_roomy)),
        ),
        spacing,
      ) { reader.device.setLineHeight(it) }
      val isDefault = size == DeviceSettings.DEFAULT_TEXT_SIZE && spacing == DeviceSettings.DEFAULT_LINE_HEIGHT
      TextButton(
        {
          reader.device.setTextSize(DeviceSettings.DEFAULT_TEXT_SIZE)
          reader.device.setLineHeight(DeviceSettings.DEFAULT_LINE_HEIGHT)
        },
        enabled = !isDefault, modifier = Modifier.align(Alignment.CenterHorizontally),
      ) { Text(stringResource(R.string.default_size), color = if (isDefault) look.faint else look.accentText) }
    }
  }
}
