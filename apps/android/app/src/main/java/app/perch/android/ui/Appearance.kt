package app.perch.android.ui

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.AppIcons
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Appearance
import app.perch.android.core.ColorMode
import app.perch.android.core.ColorOverrides
import app.perch.android.core.GlassSettings
import app.perch.android.core.Theme
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.launch

/**
 * Theme, colours and glass (synced, like Appearance in the extension and the
 * iPhone app), and this phone's wallpaper and launcher icon.
 */
@Composable
fun AppearanceScreen(reader: Reader, nav: Nav) {
  val look = LocalLook.current
  val haze = rememberHazeState()
  val scope = rememberCoroutineScope()
  val settings by reader.settings.collectAsState()
  // Which mode's colours are being edited; follows the visible one at first.
  var editing by remember { mutableStateOf<ColorMode?>(null) }
  val mode = editing ?: look.palette.scheme
  val appearance = settings.appearance ?: Appearance()
  val overrides = appearance[mode]
  val palette = Theme.palette(mode, overrides)
  val glass = settings.glass ?: GlassSettings()

  fun setColor(change: (ColorOverrides) -> ColorOverrides) {
    scope.launch {
      reader.saveSettings { s ->
        val a = s.appearance ?: Appearance()
        s.copy(appearance = if (mode == ColorMode.LIGHT) a.copy(light = change(a.light)) else a.copy(dark = change(a.dark)))
      }
    }
  }
  fun setGlass(g: GlassSettings) = scope.launch { reader.saveSettings { it.copy(glass = g) } }

  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {
        LazyColumn(
          contentPadding = PaddingValues(
            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp,
            bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 24.dp,
          ),
        ) {
          item { ListHeader(stringResource(R.string.appearance), showLogo = false) }
          item {
            Section(stringResource(R.string.theme)) {
              Spacer(Modifier.height(14.dp))
              Choice(
                listOf("system" to stringResource(R.string.theme_system), "light" to stringResource(R.string.theme_light), "dark" to stringResource(R.string.theme_dark)),
                settings.theme ?: "system",
              ) { v -> scope.launch { reader.saveSettings { it.copy(theme = v) } } }
            }
          }
          item {
            Section(stringResource(R.string.colors), footer = stringResource(R.string.colors_hint)) {
              Spacer(Modifier.height(14.dp))
              Choice(
                listOf(ColorMode.LIGHT to stringResource(R.string.light_theme), ColorMode.DARK to stringResource(R.string.dark_theme)),
                mode,
              ) { editing = it }
              ColorRow(
                stringResource(R.string.color_background), stringResource(R.string.color_background_hint),
                palette.background, overrides.background != null, Theme.backgroundPresets[mode].orEmpty(),
              ) { hex -> setColor { it.copy(background = hex) } }
              Divider()
              ColorRow(
                stringResource(R.string.color_text), stringResource(R.string.color_text_hint),
                palette.text, overrides.text != null, Theme.textPresets[palette.scheme].orEmpty(),
              ) { hex -> setColor { it.copy(text = hex) } }
              Divider()
              ColorRow(
                stringResource(R.string.accent), stringResource(R.string.color_accent_hint),
                palette.accent, overrides.accent != null, Theme.accentPresets,
              ) { hex -> setColor { it.copy(accent = hex) } }
              Divider()
              ColorRow(
                stringResource(R.string.color_buttons), stringResource(R.string.color_buttons_hint),
                palette.button, overrides.button != null, Theme.accentPresets,
              ) { hex -> setColor { it.copy(button = hex) } }
              if (!overrides.isEmpty) {
                Divider()
                ActionRow(stringResource(if (mode == ColorMode.LIGHT) R.string.reset_light_colors else R.string.reset_dark_colors)) {
                  setColor { ColorOverrides() }
                }
              }
            }
          }
          item {
            Section(stringResource(R.string.glass), footer = stringResource(R.string.glass_hint)) {
              LabeledRow(stringResource(R.string.glass_on)) { PerchSwitch(glass.enabled) { setGlass(glass.copy(enabled = it)) } }
              if (glass.enabled) {
                Divider()
                SliderRow(stringResource(R.string.transparency), glass.transparency.toFloat(), 0f..100f) { setGlass(glass.copy(transparency = it.toDouble())) }
                SliderRow(stringResource(R.string.blur), glass.blur.toFloat(), 0f..40f) { setGlass(glass.copy(blur = it.toDouble())) }
              }
              if (glass != GlassSettings()) {
                Divider()
                ActionRow(stringResource(R.string.reset_glass)) { setGlass(GlassSettings()) }
              }
            }
          }
          item { WallpaperSection(reader) }
          item { AppIconSection() }
        }
      }
      TopScrim()
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
      }
    }
  }
}

/** One colour: preset swatches, a custom hex value, and "Default". */
@Composable
private fun ColorRow(label: String, hint: String, value: String, custom: Boolean, presets: List<String>, onChange: (String?) -> Unit) {
  val look = LocalLook.current
  var typing by remember { mutableStateOf(false) }
  Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(label, color = look.text, fontSize = 16.sp)
        Text(hint, color = look.muted, fontSize = 13.sp, lineHeight = 17.sp)
      }
      if (custom) TextButton({ onChange(null) }) { Text(stringResource(R.string.default_color), color = look.accentText, fontSize = 13.sp) }
    }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      for (hex in presets) Swatch(hex, selected = hex.equals(value, ignoreCase = true)) { onChange(hex) }
      // A colour of your own, as a hex value.
      Box(
        Modifier.size(30.dp).clip(CircleShape).border(1.dp, look.hairline, CircleShape).clickable { typing = true },
        contentAlignment = Alignment.Center,
      ) { Text("#", color = look.muted, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
    }
  }
  if (typing) {
    var text by remember { mutableStateOf(value) }
    val hex = Theme.normalizeHex(text)
    AlertDialog(
      onDismissRequest = { typing = false },
      title = { Text(label) },
      text = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Box(Modifier.size(36.dp).clip(CircleShape).background(hex?.let { Color(Theme.argb(it)) } ?: Color.Transparent).border(1.dp, look.hairline, CircleShape))
          OutlinedTextField(text, { text = it.take(7) }, singleLine = true, isError = hex == null, placeholder = { Text("#ff7a1a") })
        }
      },
      confirmButton = {
        TextButton({ onChange(hex); typing = false }, enabled = hex != null) { Text(stringResource(R.string.save)) }
      },
      dismissButton = { TextButton({ typing = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
}

@Composable
private fun Swatch(hex: String, selected: Boolean, onClick: () -> Unit) {
  val look = LocalLook.current
  Box(
    Modifier.size(30.dp).clip(CircleShape).background(Color(Theme.argb(hex)))
      .border(if (selected) 3.dp else 1.dp, if (selected) look.accent else look.hairline, CircleShape)
      .clickable(onClick = onClick),
  )
}

/** A labelled slider that saves as it moves. */
@Composable
private fun SliderRow(label: String, value: Float, range: ClosedFloatingPointRange<Float>, onChange: (Float) -> Unit) {
  val look = LocalLook.current
  Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(label, color = look.text, fontSize = 16.sp, modifier = Modifier.width(110.dp))
    Slider(
      value = value, valueRange = range, onValueChange = { onChange(Math.round(it).toFloat()) },
      colors = SliderDefaults.colors(thumbColor = look.accent, activeTrackColor = look.accent),
      modifier = Modifier.weight(1f),
    )
  }
}

/** A photo behind every screen, on this phone only. */
@Composable
private fun WallpaperSection(reader: Reader) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val photo by reader.device.wallpaper.collectAsState()
  val dim by reader.device.wallpaperDim.collectAsState()
  val blur by reader.device.wallpaperBlur.collectAsState()
  val unreadable = stringResource(R.string.wallpaper_unreadable)
  val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
    uri ?: return@rememberLauncherForActivityResult
    scope.launch {
      if (!reader.device.setWallpaper(uri)) Toast.makeText(context, unreadable, Toast.LENGTH_LONG).show()
    }
  }
  Section(stringResource(R.string.background_image), footer = stringResource(R.string.background_image_hint)) {
    ActionRow(stringResource(if (photo == null) R.string.choose_photo else R.string.replace_photo)) {
      picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }
    val image = photo
    if (image != null) {
      val bitmap = remember(image) { image.asImageBitmap() }
      Image(
        bitmap, null, contentScale = ContentScale.Crop,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().height(120.dp).clip(RoundedCornerShape(14.dp)),
      )
      SliderRow(stringResource(R.string.dim), dim * 100, 0f..90f) { reader.device.setWallpaperDim(it / 100) }
      SliderRow(stringResource(R.string.blur), blur, 0f..24f) { reader.device.setWallpaperBlur(it) }
      Divider()
      Text(
        stringResource(R.string.remove_photo), color = Color(0xFFEF4444), fontSize = 16.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.fillMaxWidth().clickable { reader.device.removeWallpaper() }.padding(horizontal = 16.dp, vertical = 14.dp),
      )
    }
  }
}

/** The launcher icon: the default and five other colourings. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppIconSection() {
  val look = LocalLook.current
  val context = LocalContext.current
  var current by remember { mutableStateOf(AppIcons.current(context)) }
  Section(stringResource(R.string.app_icon), footer = stringResource(R.string.app_icon_hint)) {
    FlowRow(
      Modifier.fillMaxWidth().padding(16.dp),
      horizontalArrangement = Arrangement.spacedBy(16.dp),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      for (choice in AppIcons.choices) {
        val selected = choice.alias == current
        Column(
          Modifier.clickable {
            if (!selected) {
              AppIcons.set(context, choice.alias)
              current = choice.alias
            }
          },
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          Box(
            Modifier.size(64.dp).border(if (selected) 3.dp else 0.dp, if (selected) look.accent else Color.Transparent, RoundedCornerShape(18.dp))
              .padding(4.dp).clip(RoundedCornerShape(14.dp)),
          ) {
            Image(painterResource(choice.background), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            Image(painterResource(choice.foreground), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
          }
          Text(
            stringResource(choice.name), color = if (selected) look.text else look.muted, fontSize = 12.sp,
            modifier = Modifier.padding(top = 6.dp),
          )
        }
      }
    }
  }
}
