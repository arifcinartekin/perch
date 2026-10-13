package app.perch.android.widget

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.glance.appwidget.updateAll
import app.perch.android.MainActivity
import app.perch.android.R
import app.perch.android.core.ColorMode
import app.perch.android.core.Theme
import app.perch.android.data.LocalBackend
import app.perch.android.perch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What you see without opening the app: the widget's snapshot and, if turned
 * on, a notification when new articles arrive (Glance in the iPhone app).
 * Updated when the unread count changes and by background refresh.
 */
object Headlines {
  private const val ITEM_COUNT = 8
  private const val CHANNEL = "new-articles"
  private const val TWO_DAYS = 2 * 24 * 3600 * 1000.0
  private val json = Json { ignoreUnknownKeys = true }

  @Serializable
  data class Snapshot(
    val unread: Int,
    val items: List<Item>,
    val accentLight: String,
    val accentDark: String,
  )

  @Serializable
  data class Item(val id: String, val title: String, val feedTitle: String, val published: Double)

  private fun prefs(context: Context) = context.getSharedPreferences("headlines", Context.MODE_PRIVATE)

  fun load(context: Context): Snapshot? =
    prefs(context).getString("snapshot", null)?.let { runCatching { json.decodeFromString<Snapshot>(it) }.getOrNull() }

  /**
   * Writes the snapshot from the newest unread articles and refreshes the
   * widgets if it changed; with [notify] (background refresh), posts the
   * articles not seen before.
   */
  suspend fun update(context: Context, notify: Boolean) {
    val reader = context.perch.reader
    val backend = reader.backend
    val page = runCatching { backend.articles(LocalBackend.Scope.ALL, unreadOnly = true, limit = ITEM_COUNT) }.getOrNull() ?: return
    val titles = backend.library().feeds.associate { it.id to it.displayTitle }
    val appearance = backend.settings().appearance
    val snapshot = Snapshot(
      unread = backend.unreadCounts().values.sum(),
      items = page.map { Item(it.id, it.displayTitle, titles[it.feedId].orEmpty(), it.publishedAt) },
      accentLight = Theme.palette(ColorMode.LIGHT, appearance?.light ?: app.perch.android.core.ColorOverrides()).accent,
      accentDark = Theme.palette(ColorMode.DARK, appearance?.dark ?: app.perch.android.core.ColorOverrides()).accent,
    )
    val prefs = prefs(context)
    if (snapshot != load(context)) {
      prefs.edit().putString("snapshot", json.encodeToString(Snapshot.serializer(), snapshot)).apply()
      runCatching { UnreadWidget().updateAll(context) }
    }

    // Articles shown in the app or a notification once don't come back.
    val seenList = prefs.getString("seen", null)?.split('\n')?.filter { it.isNotEmpty() }
    val seen = seenList.orEmpty().toSet()
    val unseen = snapshot.items.filter { it.id !in seen }
    val fresh = unseen.filter { it.published > System.currentTimeMillis() - TWO_DAYS }
    prefs.edit().putString("seen", (unseen.map { it.id } + seenList.orEmpty()).take(400).joinToString("\n")).apply()
    // The first time, everything is "new"; that's not news.
    if (notify && seenList != null && fresh.isNotEmpty() && reader.device.notifyNew.value) post(context, fresh)
  }

  /** perch://article/<id>, or perch://unread: opened by the widget and notifications. */
  fun intent(context: Context, articleId: String?): Intent {
    val uri = if (articleId == null) Uri.parse("perch://unread") else Uri.parse("perch://article/${Uri.encode(articleId)}")
    return Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  private fun link(context: Context, articleId: String?): PendingIntent {
    val intent = intent(context, articleId)
    return PendingIntent.getActivity(context, intent.data.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun canNotify(context: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun post(context: Context, items: List<Item>) {
    if (!canNotify(context)) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, context.getString(R.string.notify_channel), NotificationManager.IMPORTANCE_DEFAULT),
    )
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_launcher_monochrome)
      .setAutoCancel(true)
      .setGroup(CHANNEL)
    if (items.size == 1) {
      val item = items.first()
      builder.setContentTitle(item.feedTitle).setContentText(item.title).setContentIntent(link(context, item.id))
    } else {
      val lines = items.take(3).map { it.title }
      builder.setContentTitle(context.getString(R.string.n_new_articles, items.size))
        .setContentText(lines.first())
        .setStyle(NotificationCompat.InboxStyle().also { s -> lines.forEach { s.addLine(it) } })
        .setContentIntent(link(context, null))
    }
    runCatching { NotificationManagerCompat.from(context).notify(items.joinToString(",") { it.id }.hashCode(), builder.build()) }
  }
}
