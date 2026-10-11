package app.perch.android

import android.content.Intent
import android.os.Bundle
import app.perch.android.core.ChainCode
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import app.perch.android.ui.LocalLook
import app.perch.android.ui.PerchRoot
import app.perch.android.ui.PerchTheme

class MainActivity : ComponentActivity() {
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handle(intent)
  }

  /** perch://chain?server=…&code=… from a QR code scanned with another app. */
  private fun handle(intent: Intent?) {
    val data = intent?.data?.toString() ?: return
    ChainCode.parseLink(data)?.let { perch.reader.pendingChainLink.value = it }
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
        PerchRoot(reader)
      }
    }
  }
}
