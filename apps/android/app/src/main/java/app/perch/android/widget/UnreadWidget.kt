package app.perch.android.widget

import android.content.Context
import android.text.format.DateUtils
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import app.perch.android.R
import app.perch.android.core.Theme

class UnreadWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget = UnreadWidget()
}

/**
 * The unread count and the newest unread articles, from the snapshot the app
 * writes (Headlines). Tapping an article opens it in the app.
 */
class UnreadWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM, LARGE))

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val snapshot = Headlines.load(context)
    provideContent { Content(snapshot) }
  }

  companion object {
    private val SMALL = DpSize(120.dp, 120.dp)
    private val MEDIUM = DpSize(250.dp, 120.dp)
    private val LARGE = DpSize(250.dp, 280.dp)
  }

  @Composable
  private fun Content(snapshot: Headlines.Snapshot?) {
    val context = LocalContext.current
    val size = LocalSize.current
    // The palette's background, text and the user's accent, in light and dark.
    val light = Theme.palette(app.perch.android.core.ColorMode.LIGHT)
    val dark = Theme.palette(app.perch.android.core.ColorMode.DARK)
    fun c(hex: String) = Color(Theme.argb(hex))
    val bg = ColorProvider(c(light.background), c(dark.background))
    val text = ColorProvider(c(light.text), c(dark.text))
    val muted = ColorProvider(c(light.textMuted), c(dark.textMuted))
    val accent = ColorProvider(
      c(snapshot?.accentLight ?: Theme.EMBER),
      c(snapshot?.accentDark ?: Theme.EMBER),
    )

    Column(
      GlanceModifier.fillMaxSize().background(bg).cornerRadius(22.dp).padding(14.dp)
        .clickable(actionStartActivity(Headlines.intent(context, null))),
    ) {
      Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Image(ImageProvider(R.drawable.ic_launcher_foreground), null, GlanceModifier.size(28.dp))
        Spacer(GlanceModifier.width(4.dp))
        if (snapshot == null) {
          Text(context.getString(R.string.widget_empty), style = TextStyle(color = muted, fontSize = 13.sp))
          return@Row
        }
        Text(
          snapshot.unread.toString(),
          style = TextStyle(color = accent, fontSize = 26.sp, fontWeight = FontWeight.Bold),
        )
        Spacer(GlanceModifier.width(6.dp))
        Text(context.getString(R.string.widget_unread_label), style = TextStyle(color = muted, fontSize = 13.sp))
      }
      if (snapshot == null) return@Column
      Spacer(GlanceModifier.height(8.dp))
      if (snapshot.items.isEmpty()) {
        Text(context.getString(R.string.empty_unread), style = TextStyle(color = muted, fontSize = 13.sp))
        return@Column
      }
      val small = size.width < MEDIUM.width
      val count = when {
        small -> 1
        size.height < LARGE.height -> 2
        else -> 5
      }
      for (item in snapshot.items.take(count)) {
        Column(
          GlanceModifier.fillMaxWidth().padding(vertical = 4.dp)
            .clickable(actionStartActivity(Headlines.intent(context, item.id))),
        ) {
          if (!small) {
            val ago = DateUtils.getRelativeTimeSpanString(item.published.toLong(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE)
            Text("${item.feedTitle} · $ago", maxLines = 1, style = TextStyle(color = muted, fontSize = 11.sp))
          }
          Text(item.title, maxLines = if (small) 4 else 2, style = TextStyle(color = text, fontSize = 14.sp, fontWeight = FontWeight.Medium))
        }
      }
    }
  }
}

