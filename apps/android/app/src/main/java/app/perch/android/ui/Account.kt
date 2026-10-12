package app.perch.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.ChainLink
import app.perch.android.CommunityAccount
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.RecoveryCode
import app.perch.android.core.UsernameSuggestion
import app.perch.android.data.ApiClient
import app.perch.android.data.ApiError
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val danger = Color(0xFFEF4444)

/**
 * The Perch account: a name for sharing notes as public pages, on
 * a Perch Server you or a friend runs (Perch itself hosts none). No email; a recovery code
 * stands in for "forgot password".
 */
@Composable
fun AccountScreen(reader: Reader, nav: Nav) {
  val haze = rememberHazeState()
  val account by reader.community.account.collectAsState()
  var newCode by remember { mutableStateOf<Pair<CommunityAccount, String>?>(null) }

  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize().imePadding()) {
      GlassSource(haze) {
        LazyColumn(
          contentPadding = PaddingValues(
            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp,
            bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 32.dp,
          ),
        ) {
          item { ListHeader(stringResource(R.string.perch_account), showLogo = false) }
          item {
            val code = newCode
            val a = account
            when {
              code != null -> RecoveryCodeView(code.first, code.second) { newCode = null }
              a == null -> SignIn(reader) { acc, recovery -> if (recovery != null) newCode = acc to recovery }
              else -> SignedIn(reader, a) { newCode = a to it }
            }
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
private fun describe(e: Throwable): String = when {
  e is ApiError && e.code == "network" -> stringResource(R.string.error_network)
  e is ApiError && e.code == "username-taken" -> stringResource(R.string.error_username_taken)
  e is ApiError && (e.code == "invalid-credentials" || e.status == 401) -> stringResource(R.string.error_credentials)
  else -> e.message ?: e.toString()
}

private enum class Mode { SIGN_IN, CREATE, RECOVER }

@Composable
private fun SignIn(reader: Reader, onDone: (CommunityAccount, String?) -> Unit) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var mode by rememberSaveable { mutableStateOf(Mode.SIGN_IN) }
  var server by rememberSaveable { mutableStateOf("") }
  var username by rememberSaveable { mutableStateOf("") }
  var password by rememberSaveable { mutableStateOf("") }
  var recovery by rememberSaveable { mutableStateOf("") }
  var busy by remember { mutableStateOf<String?>(null) }
  var error by remember { mutableStateOf<Throwable?>(null) }
  var info by remember { mutableStateOf<ApiClient.ServerInfo?>(null) }
  var infoError by remember { mutableStateOf<Throwable?>(null) }
  val base = ApiClient.normalizeServer(server)

  LaunchedEffect(base) {
    info = null
    infoError = null
    if (base == null) return@LaunchedEffect
    // Typing an address: wait for a pause before asking the server.
    kotlinx.coroutines.delay(500)
    runCatching { ApiClient(base).serverInfo() }
      .onSuccess { info = it }
      .onFailure { if (it !is kotlinx.coroutines.CancellationException) infoError = it }
  }
  LaunchedEffect(mode) { if (mode == Mode.CREATE && username.isEmpty()) username = UsernameSuggestion.make() }

  val working = stringResource(R.string.working)
  val proving = stringResource(R.string.proving)
  fun submit() {
    val url = base ?: return
    error = null
    scope.launch {
      try {
        val device = ChainLink.phoneName(context)
        val client = ApiClient(url)
        val name = username.trim().removePrefix("@")
        when (mode) {
          Mode.SIGN_IN -> {
            busy = working
            val auth = client.login(name, password, device)
            reader.community.save(CommunityAccount(url, auth.user.username, auth.token))
            onDone(CommunityAccount(url, auth.user.username, auth.token), null)
          }
          Mode.CREATE -> {
            busy = if ((info?.pow ?: 0) > 0) proving else working
            val code = if (info?.recovery == true) RecoveryCode.new() else null
            val auth = client.register(name, password, info?.pow, code?.replace("-", ""), device)
            val acc = CommunityAccount(url, auth.user.username, auth.token)
            reader.community.save(acc)
            onDone(acc, code)
          }
          Mode.RECOVER -> {
            busy = working
            val code = RecoveryCode.normalize(recovery) ?: throw IllegalArgumentException(context.getString(R.string.error_recovery_code))
            val auth = client.recover(name, code, password, device)
            val acc = CommunityAccount(url, auth.user.username, auth.token)
            reader.community.save(acc)
            onDone(acc, null)
          }
        }
      } catch (e: Exception) {
        error = e
      } finally {
        busy = null
      }
    }
  }

  Text(stringResource(R.string.account_intro), color = look.muted, fontSize = 15.sp, lineHeight = 21.sp, modifier = Modifier.padding(horizontal = 20.dp))
  Section(null) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        listOf(Mode.SIGN_IN to R.string.sign_in, Mode.CREATE to R.string.create_account).forEachIndexed { i, (m, label) ->
          SegmentedButton(
            selected = mode == m || (m == Mode.SIGN_IN && mode == Mode.RECOVER), onClick = { mode = m; error = null },
            shape = SegmentedButtonDefaults.itemShape(i, 2), icon = {},
            colors = SegmentedButtonDefaults.colors(activeContainerColor = look.accent.copy(alpha = 0.22f), activeContentColor = look.text),
          ) { Text(stringResource(label)) }
        }
      }
      OutlinedTextField(
        username, { username = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.username)) },
        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
        trailingIcon = if (mode == Mode.CREATE) {
          { IconButton({ username = UsernameSuggestion.make() }) { Icon(Icons.Rounded.Casino, stringResource(R.string.suggest_username), tint = look.accentText) } }
        } else null,
        supportingText = if (mode == Mode.CREATE) { { Text(stringResource(R.string.username_hint)) } } else null,
      )
      if (mode == Mode.RECOVER) {
        OutlinedTextField(
          recovery, { recovery = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
          label = { Text(stringResource(R.string.recovery_code)) },
          textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace),
        )
      }
      OutlinedTextField(
        password, { password = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(if (mode == Mode.SIGN_IN) R.string.password else R.string.new_password)) },
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        supportingText = if (mode != Mode.SIGN_IN) { { Text(stringResource(R.string.password_hint)) } } else null,
      )
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(
          onClick = ::submit,
          enabled = busy == null && base != null && username.isNotBlank() && password.length >= (if (mode == Mode.SIGN_IN) 1 else 8) &&
            (mode != Mode.CREATE || info?.signup == "open"),
          colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
        ) {
          Text(stringResource(when (mode) { Mode.SIGN_IN -> R.string.sign_in; Mode.CREATE -> R.string.create_account; Mode.RECOVER -> R.string.set_password }), fontWeight = FontWeight.SemiBold)
        }
        busy?.let {
          CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = look.accent)
          Text(it, color = look.muted, fontSize = 13.sp)
        }
      }
      if (mode == Mode.SIGN_IN) {
        Text(stringResource(R.string.forgot_password), color = look.accentText, fontSize = 14.sp, modifier = Modifier.clickable { mode = Mode.RECOVER })
      }
      if (mode == Mode.CREATE && info != null && info?.signup != "open") {
        Text(stringResource(R.string.signup_closed), color = look.muted, fontSize = 13.sp)
      }
      error?.let { Text(describe(it), color = danger, fontSize = 14.sp) }
    }
  }
  Section(
    stringResource(R.string.server),
    footer = when {
      base == null -> null
      infoError != null -> describe(infoError!!)
      info == null -> stringResource(R.string.checking_server)
      else -> null
    },
  ) {
    OutlinedTextField(
      server, { server = it }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(16.dp),
      label = { Text(stringResource(R.string.server_address)) }, placeholder = { Text("perch.example.com") },
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
    )
  }
  if (mode == Mode.CREATE) {
    val legal = info?.legal
    val ctx = LocalContext.current
    if (legal?.privacy != null || legal?.terms != null) {
      Row(Modifier.padding(horizontal = 20.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        legal.privacy?.let { u -> Text(stringResource(R.string.privacy_policy), color = look.accentText, fontSize = 13.sp, modifier = Modifier.clickable { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) }) }
        legal.terms?.let { u -> Text(stringResource(R.string.terms), color = look.accentText, fontSize = 13.sp, modifier = Modifier.clickable { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) }) }
      }
    }
  }
}

/** A new recovery code, shown once: copy it or save it as a PDF, then confirm. */
@Composable
private fun RecoveryCodeView(account: CommunityAccount, code: String, onDone: () -> Unit) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var saved by remember { mutableStateOf(false) }
  val copied = stringResource(R.string.copied)
  val pdf = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
    uri ?: return@rememberLauncherForActivityResult
    scope.launch {
      withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { RecoveryPdf.write(context, account.username, account.server, code, it) } }
      saved = true
    }
  }
  Section(stringResource(R.string.recovery_code), footer = stringResource(R.string.recovery_code_hint)) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(code, color = look.text, fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold)
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton({
          (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Perch recovery code", code))
          Toast.makeText(context, copied, Toast.LENGTH_SHORT).show()
          saved = true
        }) { Text(stringResource(R.string.copy)) }
        OutlinedButton({ pdf.launch("perch-recovery-${account.username}.pdf") }) { Text(stringResource(R.string.save_pdf)) }
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(saved, { saved = it }, colors = CheckboxDefaults.colors(checkedColor = look.accent))
        Text(stringResource(R.string.saved_it), color = look.text, fontSize = 15.sp)
      }
      Button(onDone, enabled = saved, colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast)) {
        Text(stringResource(R.string.done), fontWeight = FontWeight.SemiBold)
      }
    }
  }
}

@Composable
private fun SignedIn(reader: Reader, account: CommunityAccount, onNewCode: (String) -> Unit) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  var ask by remember { mutableStateOf<String?>(null) }
  var password by remember { mutableStateOf("") }
  var newPassword by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<Throwable?>(null) }
  val host = account.server.removePrefix("https://")

  Section(null, footer = stringResource(R.string.account_signed_in_hint)) {
    Column(Modifier.padding(16.dp)) {
      Text("@${account.username}", color = look.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
      Text(host, color = look.muted, fontSize = 14.sp)
    }
  }
  Section(null) {
    listOf(
      "recovery" to R.string.new_recovery_code,
      "password" to R.string.change_password,
    ).forEachIndexed { i, (k, label) ->
      if (i > 0) Divider()
      Text(stringResource(label), color = look.accentText, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.fillMaxWidth().clickable { ask = k; error = null; password = ""; newPassword = "" }.padding(16.dp))
    }
    Divider()
    Text(
      stringResource(R.string.sign_out), color = look.accentText, fontSize = 16.sp, fontWeight = FontWeight.Medium,
      modifier = Modifier.fillMaxWidth().clickable {
        scope.launch {
          runCatching { reader.community.client()?.logout() }
          reader.community.save(null)
        }
      }.padding(16.dp),
    )
    Divider()
    Text(
      stringResource(R.string.delete_account), color = danger, fontSize = 16.sp, fontWeight = FontWeight.Medium,
      modifier = Modifier.fillMaxWidth().clickable { ask = "delete"; error = null; password = "" }.padding(16.dp),
    )
  }
  ask?.let { kind ->
    AlertDialog(
      onDismissRequest = { if (!busy) ask = null },
      title = {
        Text(stringResource(when (kind) { "recovery" -> R.string.new_recovery_code; "password" -> R.string.change_password; else -> R.string.delete_account_title }))
      },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(stringResource(when (kind) { "recovery" -> R.string.new_recovery_code_text; "password" -> R.string.change_password_text; else -> R.string.delete_account_text }))
          OutlinedTextField(password, { password = it }, singleLine = true, label = { Text(stringResource(R.string.password)) }, visualTransformation = PasswordVisualTransformation())
          if (kind == "password") {
            OutlinedTextField(newPassword, { newPassword = it }, singleLine = true, label = { Text(stringResource(R.string.new_password)) }, visualTransformation = PasswordVisualTransformation())
          }
          error?.let { Text(describe(it), color = danger, fontSize = 13.sp) }
        }
      },
      confirmButton = {
        TextButton(enabled = !busy && password.isNotEmpty() && (kind != "password" || newPassword.length >= 8), onClick = {
          busy = true
          error = null
          scope.launch {
            try {
              val client = reader.community.client()!!
              when (kind) {
                "recovery" -> {
                  val code = RecoveryCode.new()
                  client.setRecoveryCode(account.username, password, code.replace("-", ""))
                  onNewCode(code)
                }
                "password" -> client.changePassword(account.username, password, newPassword)
                else -> {
                  client.deleteAccount(account.username, password)
                  reader.community.save(null)
                }
              }
              ask = null
            } catch (e: Exception) {
              error = e
            } finally {
              busy = false
            }
          }
        }) {
          if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
          else Text(stringResource(when (kind) { "delete" -> R.string.delete; "password" -> R.string.save; else -> R.string.make_code }), color = if (kind == "delete") danger else look.accentText)
        }
      },
      dismissButton = { TextButton({ ask = null }, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
  }
}
