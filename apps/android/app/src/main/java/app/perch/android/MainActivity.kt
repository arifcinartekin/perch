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
import androidx.compose.ui.graphics.asImageBitmap
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

  /** perch:// links: a chain's QR code scanned with another app, the widget, notifications. */
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
    val data = intent.data ?: return
    when {
      // perch://article/<id> and perch://unread, from the widget and notifications.
      data.scheme == "perch" && data.host == "article" ->
        data.lastPathSegment?.let { perch.reader.pendingArticle.value = it }
      data.scheme == "perch" && data.host == "unread" -> perch.reader.pendingUnread.value = true
      else -> ChainCode.parseLink(data.toString())?.let { perch.reader.pendingChainLink.value = it }
    }
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
      val photo by reader.device.wallpaper.collectAsState()
      val dim by reader.device.wallpaperDim.collectAsState()
      val blur by reader.device.wallpaperBlur.collectAsState()
      val image = androidx.compose.runtime.remember(photo) { photo?.asImageBitmap() }
      val wallpaper = image?.let { app.perch.android.ui.PerchLook.Wallpaper(it, dim, blur) }
      PerchTheme(settings, wallpaper) {
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
