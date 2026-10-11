package app.perch.android.ui

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.BuildConfig
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Appearance
import app.perch.android.core.ColorMode
import app.perch.android.core.GlassSettings
import app.perch.android.core.Theme
import app.perch.android.work.RefreshWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(reader: Reader, nav: Nav) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val haze = LocalHaze.current!!
  val settings by reader.settings.collectAsState()
  val listImages by reader.device.listImages.collectAsState()
  val refreshMinutes by reader.device.refreshMinutes.collectAsState()
  val glass = settings.glass ?: GlassSettings()
  val mode = if (look.dark) ColorMode.DARK else ColorMode.LIGHT
  val accent = settings.appearance?.get(mode)?.accent ?: Theme.EMBER

  val importedText = stringResource(R.string.imported)
  val importFailed = stringResource(R.string.import_failed)
  val exportedText = stringResource(R.string.exported)
  val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    uri ?: return@rememberLauncherForActivityResult
    scope.launch {
      try {
        val data = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)!!.use { it.readBytes() } }
        val r = reader.importOpml(data)
        Toast.makeText(context, importedText.format(r.added, r.existing), Toast.LENGTH_LONG).show()
      } catch (e: Exception) {
        Toast.makeText(context, importFailed, Toast.LENGTH_LONG).show()
      }
    }
  }
  val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/x-opml")) { uri ->
    uri ?: return@rememberLauncherForActivityResult
    scope.launch {
      val text = reader.exportOpml()
      withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)!!.use { it.write(text.toByteArray()) } }
      Toast.makeText(context, exportedText, Toast.LENGTH_SHORT).show()
    }
  }
  fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }

  Box(Modifier.fillMaxSize()) {
    GlassSource(haze) {
      LazyColumn(
        contentPadding = PaddingValues(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp, bottom = 130.dp),
      ) {
        item { ListHeader(stringResource(R.string.tab_settings), showLogo = true) }
        item {
          Section(stringResource(R.string.appearance)) {
            LabeledRow(stringResource(R.string.theme)) {}
            Choice(
              listOf("system" to stringResource(R.string.theme_system), "light" to stringResource(R.string.theme_light), "dark" to stringResource(R.string.theme_dark)),
              settings.theme ?: "system",
            ) { v -> scope.launch { reader.saveSettings { it.copy(theme = v) } } }
            Divider()
            LabeledRow(stringResource(R.string.reading_font)) {}
            Choice(
              listOf("sans" to stringResource(R.string.font_sans), "serif" to stringResource(R.string.font_serif)),
              settings.readingFont ?: "sans",
            ) { v -> scope.launch { reader.saveSettings { it.copy(readingFont = v) } } }
            Divider()
            LabeledRow(stringResource(R.string.accent)) {}
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              for (c in Theme.accentPresets.take(7)) {
                Box(
                  Modifier.size(30.dp).clip(CircleShape).background(c.color)
                    .then(if (c == accent) Modifier.border(3.dp, look.text, CircleShape) else Modifier)
                    .clickable {
                      scope.launch {
                        reader.saveSettings { s ->
                          val a = s.appearance ?: Appearance()
                          s.copy(appearance = a.copy(light = a.light.copy(accent = c), dark = a.dark.copy(accent = c)))
                        }
                      }
                    },
                )
              }
            }
          }
        }
        item {
          Section(stringResource(R.string.glass), footer = stringResource(R.string.glass_hint)) {
            LabeledRow(stringResource(R.string.glass_on)) {
              PerchSwitch(glass.enabled) { on -> scope.launch { reader.saveSettings { it.copy(glass = glass.copy(enabled = on)) } } }
            }
            if (glass.enabled) {
              Divider()
              LabeledRow(stringResource(R.string.transparency)) {}
              Slider(
                value = glass.transparency.toFloat(), valueRange = 0f..100f,
                onValueChange = { v -> scope.launch { reader.saveSettings { it.copy(glass = glass.copy(transparency = v.toDouble())) } } },
                colors = SliderDefaults.colors(thumbColor = look.accent, activeTrackColor = look.accent),
                modifier = Modifier.padding(horizontal = 16.dp),
              )
            }
          }
        }
        item {
          Section(stringResource(R.string.reading)) {
            LabeledRow(stringResource(R.string.list_images)) { PerchSwitch(listImages) { reader.device.setListImages(it) } }
            Divider()
            LabeledRow(stringResource(R.string.background_refresh)) {}
            Choice(
              listOf(0 to stringResource(R.string.off), 30 to stringResource(R.string.every_30m), 60 to stringResource(R.string.hourly), 360 to stringResource(R.string.every_6h)),
              refreshMinutes,
            ) { m ->
              reader.device.setRefreshMinutes(m)
              RefreshWorker.schedule(context, m)
            }
          }
        }
        item {
          Section(stringResource(R.string.library)) {
            ActionRow(stringResource(R.string.import_opml)) { importer.launch(arrayOf("*/*")) }
            Divider()
            ActionRow(stringResource(R.string.export_opml)) { exporter.launch("perch-subscriptions.opml") }
          }
        }
        item {
          val chainAccount by reader.chain.account.collectAsState()
          val chainSynced by reader.chain.lastSyncAt.collectAsState()
          Section(stringResource(R.string.sync), footer = stringResource(R.string.sync_hint)) {
            Row(
              Modifier.fillMaxWidth().clickable { nav.chain() }.padding(horizontal = 16.dp, vertical = 14.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.sync_chain), color = look.text, fontSize = 16.sp)
                Text(
                  if (chainAccount == null) stringResource(R.string.chain_off_hint)
                  else chainSynced?.let { stringResource(R.string.synced_ago, relativeTime(it)) } ?: stringResource(R.string.chain_on),
                  color = look.muted, fontSize = 13.sp,
                )
              }
              Text("›", color = look.faint, fontSize = 22.sp)
            }
          }
        }
        item {
          Section(stringResource(R.string.about), footer = stringResource(R.string.about_hint)) {
            LabeledRow(stringResource(R.string.version)) { Text(BuildConfig.VERSION_NAME, color = look.muted, fontSize = 15.sp) }
            Divider()
            ActionRow(stringResource(R.string.privacy_policy)) { open("https://perch.ws/privacy") }
            Divider()
            ActionRow(stringResource(R.string.terms)) { open("https://perch.ws/terms") }
            Divider()
            ActionRow(stringResource(R.string.source_code)) { open("https://github.com/arifcinartekin/perch") }
          }
        }
      }
    }
    TopScrim()
  }
}

@Composable
private fun LabeledRow(label: String, trailing: @Composable () -> Unit) {
  val look = LocalLook.current
  Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(label, color = look.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
    trailing()
  }
}

@Composable
private fun ActionRow(label: String, onClick: () -> Unit) {
  val look = LocalLook.current
  Text(
    label, color = look.accentText, fontSize = 16.sp, fontWeight = FontWeight.Medium,
    modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 14.dp),
  )
}

@Composable
private fun PerchSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
  val look = LocalLook.current
  Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = look.accent, checkedThumbColor = look.accentContrast))
}

@Composable
private fun <T> Choice(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
  val look = LocalLook.current
  SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
    options.forEachIndexed { i, (value, label) ->
      SegmentedButton(
        selected = value == selected,
        onClick = { onSelect(value) },
        shape = SegmentedButtonDefaults.itemShape(i, options.size),
        colors = SegmentedButtonDefaults.colors(activeContainerColor = look.accent.copy(alpha = 0.22f), activeContentColor = look.text),
        icon = {},
      ) { Text(label, fontSize = 13.sp, maxLines = 1) }
    }
  }
}
