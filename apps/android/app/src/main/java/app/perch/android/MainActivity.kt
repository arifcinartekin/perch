package app.perch.android

import android.content.Intent
import android.os.Bundle
import app.perch.android.core.ChainCode
import androidx.fragment.app.FragmentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import app.perch.android.ui.LocalLook
import app.perch.android.ui.PerchRoot
import app.perch.android.ui.PerchTheme

class MainActivity : FragmentActivity() {
  override fun onStop() {
    super.onStop()
    perch.lock.wentToBackground()
  }

  override fun onStart() {
    super.onStart()
    perch.lock.cameToForeground()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handle(intent)
  }

  /** perch://chain?server=…&code=… from a QR code scanned with another app. */
  private fun handle(intent: Intent?) {
    // Reopened from Recents, Android hands back the intent that first opened
    // the app; a chain link in it was dealt with then.
    if (intent == null || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
    if (intent.action == Intent.ACTION_SEND) {
      // A page shared from a browser: its address, wherever it is in the text.
      val text = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
      Regex("https?://\\S+").find(text)?.let { perch.reader.pendingAddUrl.value = it.value }
      setIntent(Intent(intent).setAction(Intent.ACTION_MAIN))
      return
    }
    val data = intent.data?.toString() ?: return
    ChainCode.parseLink(data)?.let { perch.reader.pendingChainLink.value = it }
    setIntent(Intent(intent).setData(null))
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val reader = perch.reader
    if (savedInstanceState == null) {
      reader.start()
      handle(intent)
    }
    enableEdgeToEdge()
    setContent {
      val settings by reader.settings.collectAsState()
      PerchTheme(settings) {
        val dark = LocalLook.current.dark
        // Status and navigation bar icons follow the palette, not the system.
        LaunchedEffect(dark) {
          val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
          else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
          enableEdgeToEdge(style, style)
        }
        val locked by perch.lock.locked.collectAsState()
        androidx.compose.foundation.layout.Box {
          // Locked, the library underneath isn't read out by accessibility services either.
          androidx.compose.foundation.layout.Box(
            if (locked) androidx.compose.ui.Modifier.clearAndSetSemantics {} else androidx.compose.ui.Modifier,
          ) { PerchRoot(reader) }
          if (locked) app.perch.android.ui.LockScreen(perch.lock)
        }
      }
    }
  }
}
