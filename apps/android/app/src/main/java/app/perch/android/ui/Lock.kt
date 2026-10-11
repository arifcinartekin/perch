package app.perch.android.ui

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Backspace
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.perch.android.AppLock
import app.perch.android.R
import dev.chrisbanes.haze.rememberHazeState

/** Can this phone open the app with a fingerprint or face? */
fun canUseBiometric(context: android.content.Context): Boolean =
  BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

/** Asks for the fingerprint or face; [onSuccess] when it matches. */
fun askBiometric(activity: FragmentActivity, title: String, cancel: String, onSuccess: () -> Unit) {
  val prompt = BiometricPrompt(
    activity, ContextCompat.getMainExecutor(activity),
    object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
    },
  )
  prompt.authenticate(
    BiometricPrompt.PromptInfo.Builder().setTitle(title).setNegativeButtonText(cancel)
      .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK).build(),
  )
}

/** The lock screen: the PIN pad on glass, with the fingerprint or face offered first. */
@Composable
fun LockScreen(lock: AppLock) {
  val look = LocalLook.current
  val context = LocalContext.current
  val haze = rememberHazeState()
  val biometricOn by lock.biometric.collectAsState()
  var pin by remember { mutableStateOf("") }
  var wrong by remember { mutableStateOf(false) }
  val title = stringResource(R.string.unlock_perch)
  val usePin = stringResource(R.string.use_pin)
  val bio = biometricOn && canUseBiometric(context)
  fun ask() = (context as? FragmentActivity)?.let { askBiometric(it, title, usePin) { lock.unlockedByBiometric() } }
  LaunchedEffect(Unit) { if (bio) ask() }

  fun press(d: String) {
    if (pin.length >= 6) return
    pin += d
    wrong = false
    if (pin.length == 6) {
      if (!lock.unlock(pin)) {
        wrong = true
        pin = ""
      }
    }
  }

  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {}
      Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        PerchMark(56.dp)
        Spacer(Modifier.size(16.dp))
        Text(stringResource(if (wrong) R.string.wrong_pin else R.string.enter_pin), color = if (wrong) Color(0xFFEF4444) else look.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.size(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          repeat(6) { i -> Box(Modifier.size(14.dp).clip(CircleShape).background(if (i < pin.length) look.accent else look.hairline)) }
        }
        Spacer(Modifier.size(36.dp))
        val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("bio", "0", "del"))
        for (row in rows) {
          Row(horizontalArrangement = Arrangement.spacedBy(22.dp), modifier = Modifier.padding(vertical = 9.dp)) {
            for (key in row) {
              Box(
                Modifier.size(76.dp).then(if (key == "bio" && !bio) Modifier else Modifier.glass(RoundedCornerShape(38.dp))).clip(CircleShape)
                  .clickable(enabled = key != "bio" || bio) {
                    when (key) {
                      "bio" -> ask()
                      "del" -> pin = pin.dropLast(1)
                      else -> press(key)
                    }
                  },
                contentAlignment = Alignment.Center,
              ) {
                when (key) {
                  "bio" -> if (bio) Icon(Icons.Rounded.Fingerprint, title, tint = look.accentText, modifier = Modifier.size(30.dp))
                  "del" -> Icon(Icons.AutoMirrored.Rounded.Backspace, null, tint = look.text, modifier = Modifier.size(24.dp))
                  else -> Text(key, color = look.text, fontSize = 28.sp)
                }
              }
            }
          }
        }
      }
    }
  }
}
