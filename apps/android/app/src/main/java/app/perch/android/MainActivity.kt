package app.perch.android

import android.os.Bundle
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
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val reader = perch.reader
    if (savedInstanceState == null) reader.start()
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
