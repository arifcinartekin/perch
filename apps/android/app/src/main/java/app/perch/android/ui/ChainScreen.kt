package app.perch.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
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
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.ChainLink
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.ChainCode
import app.perch.android.data.ChainError
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.launch

/**
 * Sync chain: start one, join one with a code or its QR code, see the
 * devices in it, leave it. The relay only ever sees encrypted records.
 */
@Composable
fun ChainScreen(reader: Reader, nav: Nav, joinServer: String? = null, joinCode: String? = null) {
  val look = LocalLook.current
  val haze = rememberHazeState()
  val chain = reader.chain
  val account by chain.account.collectAsState()

  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {
        LazyColumn(
          contentPadding = PaddingValues(
            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp,
            bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 32.dp,
          ),
        ) {
          item { ListHeader(stringResource(R.string.sync_chain), showLogo = false) }
          item {
            val a = account
            if (a == null) NotInChain(reader, joinServer, joinCode) else InChain(reader, a)
          }
        }
      }
      TopScrim()
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
      }
    }
  }
}

@Composable
private fun describe(e: Throwable): String = when (e) {
  is ChainError.NotFound -> stringResource(R.string.chain_not_found)
  is ChainError.NotARelay -> stringResource(R.string.chain_not_relay)
  is ChainError.Network -> stringResource(R.string.chain_unreachable)
  is IllegalArgumentException -> stringResource(R.string.chain_bad_code)
  else -> e.message ?: e.toString()
}

@Composable
private fun NotInChain(reader: Reader, joinServer: String?, joinCode: String?) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  var server by rememberSaveable { mutableStateOf(joinServer ?: ChainCode.DEFAULT_SERVER) }
  var code by rememberSaveable { mutableStateOf(joinCode.orEmpty()) }
  var otherRelay by rememberSaveable { mutableStateOf(joinServer != null && joinServer != ChainCode.DEFAULT_SERVER) }
  var busy by remember { mutableStateOf<String?>(null) }
  var error by remember { mutableStateOf<Throwable?>(null) }
  var scanning by remember { mutableStateOf(false) }
  val relay = ChainLink.normalizeServer(server) ?: ChainCode.DEFAULT_SERVER

  fun run(kind: String, action: suspend () -> Unit) {
    busy = kind
    error = null
    scope.launch {
      try {
        reader.enterChain(action)
      } catch (e: Exception) {
        error = e
      } finally {
        busy = null
      }
    }
  }

  Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text(stringResource(R.string.chain_intro), color = look.muted, fontSize = 15.sp, lineHeight = 21.sp)
  }
  Section(stringResource(R.string.chain_start_title), footer = stringResource(R.string.chain_start_hint)) {
    Box(Modifier.padding(16.dp)) {
      Button(
        onClick = { run("start") { reader.chain.start(relay) } }, enabled = busy == null,
        colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
      ) {
        if (busy == "start") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = look.buttonContrast)
        else Text(stringResource(R.string.chain_start), fontWeight = FontWeight.SemiBold)
      }
    }
  }
  Section(stringResource(R.string.chain_join_title), footer = stringResource(R.string.chain_join_hint)) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      OutlinedTextField(
        code, { code = it; error = null }, modifier = Modifier.fillMaxWidth(), singleLine = true,
        label = { Text(stringResource(R.string.chain_code)) },
        placeholder = { Text("XXXX-XXXX-XXXX-…") },
        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
        trailingIcon = {
          IconButton({ scanning = true }) { Icon(Icons.Rounded.QrCodeScanner, stringResource(R.string.scan_qr), tint = look.accentText) }
        },
      )
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(
          onClick = { run("join") { reader.chain.join(relay, code) } }, enabled = busy == null && code.isNotBlank(),
          colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
        ) {
          if (busy == "join") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = look.buttonContrast)
          else Text(stringResource(R.string.chain_join), fontWeight = FontWeight.SemiBold)
        }
        OutlinedButton({ scanning = true }) {
          Icon(Icons.Rounded.QrCodeScanner, null, Modifier.size(18.dp))
          Text(" " + stringResource(R.string.scan_qr))
        }
      }
    }
  }
  Section(stringResource(R.string.chain_relay)) {
    if (otherRelay) {
      OutlinedTextField(
        server, { server = it }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(16.dp),
        label = { Text(stringResource(R.string.chain_relay_address)) },
      )
    } else {
      Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(ChainCode.DEFAULT_SERVER.removePrefix("https://"), color = look.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
        Text(stringResource(R.string.use_another), color = look.accentText, fontSize = 15.sp, modifier = Modifier.clickable { otherRelay = true })
      }
    }
  }
  error?.let {
    Text(describe(it), color = androidx.compose.ui.graphics.Color(0xFFEF4444), fontSize = 14.sp, modifier = Modifier.padding(20.dp))
  }
  if (scanning) {
    val notChain = stringResource(R.string.not_a_chain_qr)
    val context = LocalContext.current
    QrScanner(
      onResult = { text ->
        scanning = false
        val link = ChainCode.parseLink(text)
        val typed = ChainCode.normalize(text)
        when {
          link != null -> {
            server = link.first
            otherRelay = link.first != ChainCode.DEFAULT_SERVER
            code = link.second
            run("join") { reader.chain.join(link.first, link.second) }
          }
          typed != null -> code = typed
          else -> Toast.makeText(context, notChain, Toast.LENGTH_LONG).show()
        }
      },
      onDismiss = { scanning = false },
    )
  }
}

@Composable
private fun InChain(reader: Reader, account: app.perch.android.ChainAccount) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val chain = reader.chain
  val syncing by chain.syncing.collectAsState()
  val lastSyncAt by chain.lastSyncAt.collectAsState()
  val problem by chain.problem.collectAsState()
  val devices by chain.devices.collectAsState()
  var showCode by rememberSaveable { mutableStateOf(false) }
  var confirm by remember { mutableStateOf<String?>(null) }
  val copied = stringResource(R.string.copied)

  val status = when (val p = problem) {
    ChainLink.Problem.Ended -> stringResource(R.string.chain_ended)
    ChainLink.Problem.Unreachable -> stringResource(R.string.chain_unreachable)
    is ChainLink.Problem.Other -> p.message
    null -> lastSyncAt?.let { stringResource(R.string.synced_ago, relativeTime(it)) } ?: stringResource(R.string.not_synced_yet)
  }

  Section(null) {
    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(stringResource(R.string.chain_on), color = look.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        Text(
          "${account.server.removePrefix("https://")} · $status",
          color = if (problem != null) androidx.compose.ui.graphics.Color(0xFFEF4444) else look.muted, fontSize = 13.sp,
        )
      }
      if (syncing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = look.accent)
      else IconButton({ scope.launch { reader.syncChain() } }) { Icon(Icons.Rounded.Sync, stringResource(R.string.sync_now), tint = look.accentText) }
    }
  }
  Section(stringResource(R.string.add_device), footer = stringResource(R.string.add_device_hint)) {
    Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
      if (showCode) {
        QrCode(ChainCode.link(account.server, account.code))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(account.code, color = look.text, fontFamily = FontFamily.Monospace, fontSize = 15.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f, fill = false))
          IconButton({
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("Perch chain", account.code))
            Toast.makeText(context, copied, Toast.LENGTH_SHORT).show()
          }) { Icon(Icons.Rounded.ContentCopy, stringResource(R.string.copy), tint = look.accentText) }
        }
        TextButton({ showCode = false }) { Text(stringResource(R.string.hide_code)) }
      } else {
        Button(
          { showCode = true },
          colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
        ) { Text(stringResource(R.string.show_code), fontWeight = FontWeight.SemiBold) }
      }
    }
  }
  Section(stringResource(R.string.devices), footer = stringResource(R.string.devices_hint)) {
    val sorted = devices.entries.sortedByDescending { it.value.seenAt }
    if (sorted.isEmpty()) {
      Text(stringResource(R.string.no_devices_yet), color = look.muted, fontSize = 15.sp, modifier = Modifier.padding(16.dp))
    }
    sorted.forEachIndexed { i, (id, d) ->
      if (i > 0) Divider()
      Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 6.dp, bottom = 6.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          val me = id == account.node
          Text(d.name + if (me) " · " + stringResource(R.string.this_device) else "", color = look.text, fontSize = 16.sp)
          Text(platformName(d.platform) + " · " + stringResource(R.string.seen_ago, relativeTime(d.seenAt)), color = look.muted, fontSize = 13.sp)
        }
        if (id != account.node) {
          IconButton({ scope.launch { chain.forget(id) } }) { Icon(Icons.Rounded.Close, stringResource(R.string.forget), tint = look.faint) }
        }
      }
    }
  }
  Section(null) {
    Text(
      stringResource(R.string.leave_chain), color = look.accentText, fontSize = 16.sp, fontWeight = FontWeight.Medium,
      modifier = Modifier.fillMaxWidth().clickable { confirm = "leave" }.padding(16.dp),
    )
    Divider()
    Text(
      stringResource(R.string.delete_chain), color = androidx.compose.ui.graphics.Color(0xFFEF4444), fontSize = 16.sp, fontWeight = FontWeight.Medium,
      modifier = Modifier.fillMaxWidth().clickable { confirm = "delete" }.padding(16.dp),
    )
  }
  confirm?.let { kind ->
    AlertDialog(
      onDismissRequest = { confirm = null },
      title = { Text(stringResource(if (kind == "leave") R.string.leave_chain_title else R.string.delete_chain_title)) },
      text = { Text(stringResource(if (kind == "leave") R.string.leave_chain_text else R.string.delete_chain_text)) },
      confirmButton = {
        TextButton({
          confirm = null
          scope.launch {
            runCatching { if (kind == "leave") chain.leave() else chain.delete() }
            reader.afterChainChange()
          }
        }) { Text(stringResource(if (kind == "leave") R.string.leave else R.string.delete)) }
      },
      dismissButton = { TextButton({ confirm = null }) { Text(stringResource(R.string.cancel)) } },
    )
  }
}

@Composable
private fun platformName(platform: String): String = when (platform) {
  "ios" -> "iPhone"
  "android" -> "Android"
  "extension", "chrome", "firefox", "edge" -> stringResource(R.string.browser_extension)
  "web" -> "Web"
  else -> platform.ifEmpty { "?" }
}
