package app.perch.android.ui

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.core.Article
import app.perch.android.core.Feed
import app.perch.android.core.FeedIds
import app.perch.android.core.HtmlText
import coil3.compose.AsyncImage
import java.net.URI

/**
 * A feed's letter tile. Perch draws its own instead of loading favicons, so
 * opening the list asks no site for anything (as in the extension and on the iPhone).
 */
@Composable
fun FeedIcon(feed: Feed?, size: Dp = 18.dp) {
  val title = feed?.displayTitle.orEmpty()
  val letter = title.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar() ?: '•'
  val hue = (FeedIds.fnv1aHex(feed?.id ?: title).take(4).toInt(16) % 360).toFloat()
  Box(
    Modifier.size(size).clip(RoundedCornerShape(size * 0.28f)).background(Color.hsl(hue, 0.55f, 0.48f)),
    contentAlignment = Alignment.Center,
  ) {
    Text(letter.toString(), color = Color.White, fontSize = (size.value * 0.58f).sp, fontWeight = FontWeight.Bold)
  }
}

fun relativeTime(epochMs: Double): String =
  DateUtils.getRelativeTimeSpanString(
    epochMs.toLong(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE,
  ).toString()

/** A list row's preview text and picture (the iPhone app's ArticlePreview). */
data class ArticlePreview(val text: String, val image: String?) {
  companion object {
    private val cache = object : LinkedHashMap<String, ArticlePreview>(512, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ArticlePreview>?) = size > 3000
    }
    private val links = Regex("https?://\\S+")
    private val hnNoise = Regex("(?i)(article url|comments url|points|# comments)\\s*:\\s*\\d*")
    private val img = Regex("(?i)<img\\b[^>]*>")
    private val imgSize = Regex("(?i)\\s(?:width|height)\\s*=\\s*[\"']?(\\d+)")
    private val imgSrc = Regex("(?i)\\ssrc\\s*=\\s*[\"']([^\"']+)[\"']")

    fun of(article: Article): ArticlePreview = synchronized(cache) {
      cache.getOrPut(article.id) { make(article) }
    }

    private fun make(article: Article): ArticlePreview {
      val title = article.displayTitle
      var s = HtmlText.plain(article.summaryHtml ?: article.contentHtml ?: "", 400)
      if (s.startsWith(title)) s = s.drop(title.length)
      s = s.replace(links, " ").replace(hnNoise, " ").replace(Regex("\\s+"), " ").trim()
      if (s.count { it.isLetter() } < 25 || s == title) s = ""
      return ArticlePreview(s, image(article))
    }

    private fun image(article: Article): String? {
      val base = article.url?.let { runCatching { URI(it) }.getOrNull() }
      fun absolute(u: String) = runCatching { base?.resolve(u)?.toString() ?: u }.getOrNull()
        ?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
      article.enclosures.firstOrNull { it.type?.startsWith("image/") == true }?.let { e ->
        absolute(e.url)?.let { return it }
      }
      for (tag in img.findAll((article.contentHtml ?: "") + (article.summaryHtml ?: ""))) {
        val n = imgSize.find(tag.value)?.groupValues?.get(1)?.toIntOrNull()
        if (n != null && n < 40) continue
        val src = imgSrc.find(tag.value)?.groupValues?.get(1) ?: continue
        val url = absolute(HtmlText.decodeEntities(src)) ?: continue
        val lower = url.lowercase()
        if ("pixel" in lower || "feedburner" in lower || "emoji" in lower || lower.endsWith(".svg")) continue
        return url
      }
      return null
    }
  }
}

@Composable
fun ArticleRow(article: Article, feed: Feed?, showFeed: Boolean, showImage: Boolean, modifier: Modifier = Modifier) {
  val look = LocalLook.current
  val preview = ArticlePreview.of(article)
  Row(
    modifier.fillMaxWidth().alpha(if (article.read) 0.72f else 1f).padding(horizontal = 20.dp, vertical = 12.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!article.read) Box(Modifier.size(7.dp).clip(CircleShape).background(look.accent))
        if (showFeed && feed != null) {
          FeedIcon(feed, 16.dp)
          Text(
            feed.displayTitle, color = look.faint, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
          )
          Text("·", color = look.faint, fontSize = 12.sp)
        }
        Text(relativeTime(article.publishedAt), color = look.faint, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        Spacer(Modifier.weight(1f))
        if (article.starred) Icon(Icons.Rounded.Star, null, tint = look.accent, modifier = Modifier.size(14.dp))
      }
      Text(
        article.displayTitle,
        color = if (article.read) look.muted else look.text,
        fontSize = 17.sp,
        lineHeight = 22.sp,
        fontWeight = if (article.read) FontWeight.Medium else FontWeight.SemiBold,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
      )
      if (preview.text.isNotEmpty()) {
        Text(preview.text, color = look.muted, fontSize = 14.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
    }
    if (showImage && preview.image != null) {
      AsyncImage(
        model = preview.image, contentDescription = null, contentScale = ContentScale.Crop,
        modifier = Modifier.size(76.dp).clip(RoundedCornerShape(12.dp)).background(look.hairline),
      )
    }
  }
}

/** A titled group of rows on a glass card, as in Settings. */
@Composable
fun Section(title: String?, modifier: Modifier = Modifier, footer: String? = null, content: @Composable ColumnScope.() -> Unit) {
  val look = LocalLook.current
  Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
    if (title != null) {
      Text(
        title.uppercase(), color = look.faint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp, modifier = Modifier.padding(start = 16.dp, bottom = 6.dp, top = 18.dp),
      )
    }
    Column(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
        .background(look.solid.copy(alpha = look.surfaceOpacity(0.3))),
      content = content,
    )
    if (footer != null) {
      Text(footer, color = look.faint, fontSize = 12.sp, lineHeight = 16.sp, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp))
    }
  }
}

@Composable
fun Divider(inset: Dp = 16.dp) {
  Box(Modifier.fillMaxWidth().padding(start = inset).height(0.5.dp).background(LocalLook.current.hairline))
}

@Composable
fun Hspace(width: Dp) = Spacer(Modifier.width(width))
