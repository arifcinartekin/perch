package app.perch.android.data

import app.perch.android.core.Article
import app.perch.android.core.Category
import app.perch.android.core.Feed
import app.perch.android.core.FullText
import app.perch.android.core.Library
import app.perch.android.core.Note
import app.perch.android.core.SyncedSettings

/** What adding a feed gave: the feed, and whether it's new to the library. */
data class AddResult(val feed: Feed, val created: Boolean)

/** An OPML import: feeds added, ones already there, categories made. */
data class ImportResult(val added: Int, val existing: Int, val categories: Int)

/**
 * Where the library lives: this phone ([LocalBackend]) or a Perch Server of
 * your own ([ServerBackend], personal mode). The Reader and the screens talk to
 * either the same way, like ReaderBackend in the iPhone app. Article ids are
 * "feedId:articleId" throughout.
 */
interface ReaderBackend {
  enum class Scope { ALL, STARRED }

  suspend fun library(): Library
  suspend fun settings(): SyncedSettings
  suspend fun saveSettings(change: (SyncedSettings) -> SyncedSettings): SyncedSettings
  suspend fun unreadCounts(): Map<String, Int>
  suspend fun starredCount(): Int

  /** Newest first; [before] is the last article of the previous page. */
  suspend fun articles(
    scope: Scope,
    feed: String? = null,
    category: String? = null,
    unreadOnly: Boolean = false,
    search: String = "",
    before: Article? = null,
    limit: Int = 50,
  ): List<Article>

  suspend fun article(id: String): Article?
  suspend fun setState(ids: List<String>, read: Boolean? = null, starred: Boolean? = null)
  suspend fun markAllRead(feed: String? = null, category: String? = null)
  suspend fun cachedFullText(article: Article): FullText?
  suspend fun fullText(article: Article, force: Boolean = false): FullText

  /** Fetches feeds now: some, or (null) all of them. */
  suspend fun refresh(ids: Collection<String>? = null)
  suspend fun addFeed(input: String, categoryId: String? = null): AddResult
  suspend fun removeFeed(id: String)
  suspend fun updateFeed(id: String, categoryId: String? = null, customTitle: String? = null)
  suspend fun addCategory(name: String): Category
  suspend fun setCategoryCollapsed(id: String, collapsed: Boolean)
  /** Its feeds move to Uncategorized. */
  suspend fun deleteCategory(id: String)

  /** Newest first. */
  suspend fun notes(): List<Note>
  suspend fun note(id: String): Note? = notes().firstOrNull { it.id == id }
  suspend fun saveNote(article: Article, feedTitle: String?, body: String): Note
  suspend fun deleteNote(id: String)

  suspend fun exportOpml(): String
  suspend fun importOpml(data: ByteArray): ImportResult

  companion object {
    /** Longest note, in characters (NOTE_MAX in core). */
    const val NOTE_MAX = 10_000
  }
}
