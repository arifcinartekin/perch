package app.perch.android.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.DeviceSettings
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.data.ApiClient
import kotlinx.coroutines.launch

/**
 * The parts of a library account the Perch account doesn't have: reading
 * offline, the devices signed in, invites (for the admin), the email address
 * and the server's own policies.
 */
@Composable
fun LibraryAccountSections(reader: Reader, client: ApiClient) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var user by remember { mutableStateOf<ApiClient.User?>(null) }
  var info by remember { mutableStateOf<ApiClient.ServerInfo?>(null) }
  var devices by remember { mutableStateOf<List<ApiClient.Device>>(emptyList()) }
  var invites by remember { mutableStateOf<List<ApiClient.Invite>>(emptyList()) }
  var error by remember { mutableStateOf<Throwable?>(null) }
  var editingEmail by remember { mutableStateOf(false) }
  val offline by reader.device.offlineEnabled.collectAsState()
  val limit by reader.device.offlineLimit.collectAsState()

  suspend fun load() {
    runCatching { client.serverInfo() }.onSuccess { info = it }
    runCatching { client.me() }.onSuccess { user = it }
    runCatching { client.devices() }.onSuccess { devices = it }
    if (user?.role == "admin") runCatching { client.invites() }.onSuccess { invites = it }
  }
  fun act(work: suspend () -> Unit) = scope.launch {
    error = null
    try {
      work()
      load()
    } catch (e: Exception) {
      error = e
    }
  }
  LaunchedEffect(client) { load() }

  Section(stringResource(R.string.offline_reading), footer = stringResource(R.string.offline_reading_hint)) {
    LabeledRow(stringResource(R.string.offline_save)) {
      PerchSwitch(offline) {
        reader.device.setOfflineEnabled(it)
        if (it) scope.launch { runCatching { reader.server?.downloadForOffline(limit) } }
      }
    }
    if (offline) {
      Divider()
      LabeledRow(stringResource(R.string.offline_keep)) {}
      Choice(DeviceSettings.OFFLINE_LIMITS.map { it to it.toString() }, limit) {
        reader.device.setOfflineLimit(it)
        scope.launch { runCatching { reader.server?.downloadForOffline(it) } }
      }
    }
  }

  Section(stringResource(R.string.devices), footer = stringResource(R.string.server_devices_hint)) {
    devices.forEachIndexed { i, d ->
      if (i > 0) Divider()
      Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(d.name, color = look.text, fontSize = 16.sp)
          Text(
            if (d.current) stringResource(R.string.this_device) else stringResource(R.string.seen_ago, relativeTime(d.lastSeenAt)),
            color = look.muted, fontSize = 13.sp,
          )
        }
        if (!d.current) {
          TextButton({ act { client.revokeDevice(d.id) } }) { Text(stringResource(R.string.sign_out), color = look.accentText) }
        }
      }
    }
  }

  Section(stringResource(R.string.email), footer = stringResource(R.string.email_hint)) {
    Text(
      stringResource(if (user?.hasEmail == true) R.string.email_on else R.string.email_off),
      color = look.text, fontSize = 16.sp, modifier = Modifier.padding(16.dp),
    )
    if (info?.email == true) {
      Divider()
      ActionRow(stringResource(if (user?.hasEmail == true) R.string.change_email else R.string.add_email)) { editingEmail = true }
    }
    if (user?.hasEmail == true) {
      Divider()
      Text(
        stringResource(R.string.remove_email), color = Color(0xFFEF4444), fontSize = 16.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.fillMaxWidth().clickable { act { client.removeEmail() } }.padding(horizontal = 16.dp, vertical = 14.dp),
      )
    }
  }

  if (user?.role == "admin") {
    Section(stringResource(R.string.invites), footer = stringResource(R.string.invites_hint)) {
      invites.forEach { invite ->
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text(invite.code, color = look.text, fontFamily = FontFamily.Monospace, fontSize = 15.sp)
            Text(
              invite.usedBy?.let { stringResource(R.string.invite_used_by, it) } ?: stringResource(R.string.invite_unused),
              color = look.muted, fontSize = 13.sp,
            )
          }
          if (invite.usedBy == null) {
            TextButton({ act { client.deleteInvite(invite.code) } }) { Text(stringResource(R.string.delete), color = look.accentText) }
          }
        }
        Divider()
      }
      ActionRow(stringResource(R.string.create_invite)) { act { client.createInvite() } }
    }
  }

  // The server is someone's (yours, or a friend's): its own policies apply there.
  val legal = info?.legal
  val host = client.server.substringAfter("://")
  Section(
    host,
    footer = stringResource(if (legal?.privacy != null) R.string.server_operator else R.string.server_operator_no_policy, host),
  ) {
    legal?.privacy?.let { u -> ActionRow(stringResource(R.string.privacy_policy)) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } }
    legal?.terms?.let { u ->
      Divider()
      ActionRow(stringResource(R.string.terms)) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) }
    }
  }

  error?.let { Text(describeAccountError(it), color = Color(0xFFEF4444), fontSize = 14.sp, modifier = Modifier.padding(horizontal = 20.dp)) }

  if (editingEmail) EmailDialog(client) {
    editingEmail = false
    scope.launch { load() }
  }
}

/** A new address on the account: a code to it first, then the code back. */
@Composable
private fun EmailDialog(client: ApiClient, onDone: () -> Unit) {
  val scope = rememberCoroutineScope()
  var email by remember { mutableStateOf("") }
  var code by remember { mutableStateOf("") }
  var sent by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<Throwable?>(null) }
  AlertDialog(
    onDismissRequest = { if (!busy) onDone() },
    title = { Text(stringResource(R.string.email)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
          email, { email = it; sent = null }, singleLine = true, label = { Text(stringResource(R.string.email)) },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
        )
        sent?.let {
          Text(stringResource(R.string.email_code_sent, it), fontSize = 13.sp)
          OutlinedTextField(
            code, { code = it.filter(Char::isDigit).take(6) }, singleLine = true, label = { Text(stringResource(R.string.email_code)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
          )
        }
        error?.let { Text(describeAccountError(it), color = Color(0xFFEF4444), fontSize = 13.sp) }
      }
    },
    confirmButton = {
      TextButton(
        enabled = !busy && email.contains('@') && (sent == null || code.length == 6),
        onClick = {
          busy = true
          error = null
          scope.launch {
            try {
              val to = sent
              if (to == null) {
                client.requestEmailCode(email.trim(), "change", java.util.Locale.getDefault().language)
                sent = email.trim()
              } else {
                client.changeEmail(to, code)
                onDone()
              }
            } catch (e: Exception) {
              error = e
            } finally {
              busy = false
            }
          }
        },
      ) { Text(stringResource(if (sent == null) R.string.send_code else R.string.save)) }
    },
    dismissButton = { TextButton({ onDone() }, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
  )
}
