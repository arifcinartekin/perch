package app.perch.android.core

import kotlinx.serialization.Serializable

// The library's types, mirroring packages/core/src/types.ts and the iPhone
// app's PerchKit models, so data moves between the apps unchanged. Times are
// epoch milliseconds.

@Serializable
data class Feed(
  val id: String,
  val url: String,
  val title: String = "",
  val customTitle: String? = null,
  val siteUrl: String? = null,
  val iconUrl: String? = null,
  val categoryId: String = UNCATEGORIZED_ID,
  val addedAt: Double = 0.0,
  val lastFetchedAt: Double? = null,
  val lastError: String? = null,
) {
  /** The custom title when set, else the feed's own, else its host. */
  val displayTitle: String
    get() = customTitle?.takeIf { it.isNotEmpty() }
      ?: title.ifEmpty { runCatching { java.net.URI(url).host }.getOrNull() ?: url }
}

@Serializable
data class Category(
  val id: String,
  val name: String,
  val order: Double,
  val collapsed: Boolean? = null,
)

/** The category every feed falls back to (UNCATEGORIZED_ID in core). */
const val UNCATEGORIZED_ID = "uncategorized"

@Serializable
data class Enclosure(val url: String, val type: String? = null, val length: Double? = null)

data class Article(
  /** The article's own id; unique only within its feed. */
  val articleId: String,
  val feedId: String,
  val url: String?,
  val title: String,
  val author: String?,
  val publishedAt: Double,
  val summaryHtml: String?,
  val contentHtml: String?,
  val enclosures: List<Enclosure>,
  val read: Boolean = false,
  val starred: Boolean = false,
) {
  /** Unique across feeds: `feedId:articleId`, the form sync uses. */
  val id: String get() = "$feedId:$articleId"
  val displayTitle: String get() = if (title.isEmpty()) "Untitled" else HtmlText.decodeEntities(title)
}

data class FullText(val html: String, val title: String?, val byline: String?)

@Serializable
data class Library(
  val feeds: List<Feed> = emptyList(),
  val categories: List<Category> = emptyList(),
)

/** The settings that follow the library (SyncedSettings in core). */
@Serializable
data class SyncedSettings(
  val theme: String? = null,
  val readingFont: String? = null,
  val appearance: Appearance? = null,
  val glass: GlassSettings? = null,
)

/** A note on an article (packages/core/src/notes.ts). */
@Serializable
data class Note(
  val feedId: String,
  val articleId: String,
  val title: String,
  val url: String? = null,
  val feedTitle: String? = null,
  val body: String,
  val createdAt: Double,
  val updatedAt: Double,
  val sharedUrl: String? = null,
) {
  val id: String get() = "$feedId:$articleId"
}
