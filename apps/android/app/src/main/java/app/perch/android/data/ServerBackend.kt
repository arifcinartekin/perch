package app.perch.android.data

import app.perch.android.core.Article
import app.perch.android.core.Category
import app.perch.android.core.FullText
import app.perch.android.core.Library
import app.perch.android.core.Note
import app.perch.android.core.SyncedSettings
import java.io.File
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/**
 * A library on a Perch Server of your own (personal mode): the server fetches
 * the feeds and keeps the library, so it's the same in the extension, the web
 * reader and the iPhone app. The phone keeps an offline copy: the library and
 * settings in [cacheFile], the articles it has seen, the newest unread and
 * every starred one in [store] (OfflineStore and OfflineSync in the iPhone
 * app). Read and star changes made offline wait in the store's queue and go
 * out when the server answers again.
 */
class ServerBackend(
  val client: ApiClient,
  internal val store: ArticleStore,
  private val cacheFile: File,
) : ReaderBackend {
  @Serializable
  private data class Cache(
    val library: Library = Library(),
    val settings: SyncedSettings = SyncedSettings(),
    val notes: List<Note> = emptyList(),
    val unread: Map<String, Int> = emptyMap(),
    val starred: Int = 0,
  )

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; explicitNulls = false }
  private val lock = Mutex()
  private var cache: Cache? = null

  private val _offline = MutableStateFlow(false)
  /** The server didn't answer the last request; lists show the offline copy. */
  val offline: StateFlow<Boolean> = _offline.asStateFlow()

  /** Set when the server turns the session down (signed out elsewhere, account deleted). */
  var onUnauthorized: (() -> Unit)? = null

  private suspend fun cached(): Cache = lock.withLock {
    cache ?: withContext(Dispatchers.IO) {
      runCatching { json.decodeFromString<Cache>(cacheFile.readText()) }.getOrDefault(Cache())
    }.also { cache = it }
  }

  private suspend fun remember(change: (Cache) -> Cache) {
    val next = change(cached())
    lock.withLock {
      cache = next
      withContext(Dispatchers.IO) {
        cacheFile.parentFile?.mkdirs()
        val tmp = File(cacheFile.parentFile, cacheFile.name + ".tmp")
        tmp.writeText(json.encodeToString(Cache.serializer(), next))
        tmp.renameTo(cacheFile)
      }
    }
  }

  /** Runs [call]; a network failure gives [fallback] (marking the library offline), a 401 signs out. */
  private suspend fun <T> online(fallback: suspend () -> T, call: suspend () -> T): T = try {
    call().also { _offline.value = false }
  } catch (e: ApiError) {
    when {
      e.code == "network" -> {
        _offline.value = true
        fallback()
      }
      e.status == 401 -> {
        onUnauthorized?.invoke()
        throw e
      }
      else -> throw e
    }
  }

  /** Runs [call], which has no offline version: a network failure is reported as one. */
  private suspend fun <T> required(call: suspend () -> T): T = online({ throw ApiError(0, "network", "The server can't be reached") }, call)

  // Library

  override suspend fun library(): Library = online({ cached().library }) {
    client.library().also { lib -> remember { it.copy(library = lib) } }
  }

  override suspend fun settings(): SyncedSettings = online({ cached().settings }) {
    client.settings().also { s -> remember { it.copy(settings = s) } }
  }

  override suspend fun saveSettings(change: (SyncedSettings) -> SyncedSettings): SyncedSettings {
    val next = change(cached().settings)
    // Shown at once; the server's copy follows when it answers.
    remember { it.copy(settings = next) }
    return online({ next }) { client.saveSettings(next).also { s -> remember { it.copy(settings = s) } } }
  }

  override suspend fun unreadCounts(): Map<String, Int> = online({ offlineCounts() }) {
    flush()
    val counts = client.counts()
    remember { it.copy(unread = counts.unread, starred = counts.starred) }
    counts.unread
  }

  private suspend fun offlineCounts(): Map<String, Int> {
    val feeds = cached().library.feeds.map { it.id }.toSet()
    return withContext(Dispatchers.IO) { store.unreadCounts().filterKeys { it in feeds } }
  }

  override suspend fun starredCount(): Int =
    if (_offline.value) withContext(Dispatchers.IO) { store.starredCount() } else cached().starred

  // Articles

  override suspend fun articles(
    scope: ReaderBackend.Scope,
    feed: String?,
    category: String?,
    unreadOnly: Boolean,
    search: String,
    before: Article?,
    limit: Int,
  ): List<Article> = online({
    val library = cached().library
    withContext(Dispatchers.IO) { store.list(library, scope, feed, category, unreadOnly, search, before, limit) }
  }) {
    flush()
    val page = client.articles(
      feed, category, unreadOnly, scope == ReaderBackend.Scope.STARRED, search, before?.let(::articleCursor), limit,
    )
    val items = page.items.map { it.toArticle() }
    keep(items)
    items
  }


  /** Stores what the server sent, keeping changes still waiting to go out. */
  private suspend fun keep(items: List<Article>) = withContext(Dispatchers.IO) {
    if (items.isEmpty()) return@withContext
    val waiting = store.pending().associateBy { it.id }
    store.upsert(
      items.map { a ->
        val p = waiting[a.id] ?: return@map a
        a.copy(read = p.read ?: a.read, starred = p.starred ?: a.starred)
      },
    )
  }

  override suspend fun article(id: String): Article? =
    withContext(Dispatchers.IO) { store.article(id) } ?: run {
      val (feedId, articleId) = split(id) ?: return null
      online({ null }) { client.article(feedId, articleId).also { keep(listOf(it)) } }
    }

  override suspend fun setState(ids: List<String>, read: Boolean?, starred: Boolean?) {
    withContext(Dispatchers.IO) {
      ids.forEach {
        store.setState(it, read, starred)
        store.enqueue(it, read, starred)
      }
    }
    online({}) { flush() }
  }

  /** Sends queued read and star changes, a batch per kind of change. */
  suspend fun flush() {
    val pending = withContext(Dispatchers.IO) { store.pending() }
    if (pending.isEmpty()) return
    for ((change, entries) in pending.groupBy { it.read to it.starred }) {
      val items = entries.mapNotNull { split(it.id) }
      if (items.isNotEmpty() && (change.first != null || change.second != null)) {
        items.chunked(1000).forEach { client.setState(it, change.first, change.second) }
      }
      withContext(Dispatchers.IO) { store.clearPending(entries) }
    }
  }

  override suspend fun markAllRead(feed: String?, category: String?) {
    val now = System.currentTimeMillis().toDouble()
    var ids: Set<String>? = null
    if (feed != null) ids = setOf(feed)
    if (category != null) ids = cached().library.feeds.filter { it.categoryId == category }.map { it.id }.toSet()
    val marked = withContext(Dispatchers.IO) { store.markRead(ids, now) }
    online({ withContext(Dispatchers.IO) { marked.forEach { store.enqueue(it, read = true) } } }) {
      client.markAllRead(feed, category, now)
    }
  }

  override suspend fun cachedFullText(article: Article): FullText? = withContext(Dispatchers.IO) { store.fullText(article.id) }

  override suspend fun fullText(article: Article, force: Boolean): FullText {
    val text = required { client.fullText(article.feedId, article.articleId, force) }
    withContext(Dispatchers.IO) { store.saveFullText(article.id, text) }
    return text
  }

  // Fetching and the offline copy

  override suspend fun refresh(ids: Collection<String>?) {
    online({}) {
      flush()
      client.refresh(ids)
    }
  }

  /**
   * Keeps the newest [limit] unread articles and every starred one on the
   * phone, and drops the rest (OfflineSync in the iPhone app).
   */
  suspend fun downloadForOffline(limit: Int) = online({}) {
    flush()
    val keepIds = mutableSetOf<String>()
    suspend fun take(starred: Boolean, max: Int) {
      var cursor: String? = null
      while (keepIds.size < max) {
        val page = client.articles(null, null, unreadOnly = !starred, starred = starred, search = "", before = cursor, limit = 100)
        val items = page.items.map { it.toArticle() }
        keep(items)
        keepIds += items.map { it.id }
        cursor = page.next ?: break
      }
    }
    take(starred = false, max = limit)
    take(starred = true, max = Int.MAX_VALUE)
    withContext(Dispatchers.IO) { store.deleteArticles(notIn = keepIds, keepStarred = true) }
  }

  override suspend fun addFeed(input: String, categoryId: String?): AddResult {
    var url = input.trim()
    if (!url.contains("://")) url = "https://$url"
    val added = required { client.addFeed(url, categoryId) }
    return AddResult(added.feed, added.created)
  }

  override suspend fun removeFeed(id: String) {
    required { client.removeFeed(id) }
    withContext(Dispatchers.IO) { store.deleteArticles(id, keepStarred = true) }
  }

  override suspend fun updateFeed(id: String, categoryId: String?, customTitle: String?) =
    required { client.updateFeed(id, categoryId, customTitle) }

  override suspend fun addCategory(name: String): Category {
    cached().library.categories.firstOrNull { it.name.equals(name.trim(), ignoreCase = true) }?.let { return it }
    return required { client.addCategory(name.trim()) }
  }

  override suspend fun setCategoryCollapsed(id: String, collapsed: Boolean) =
    required { client.updateCategory(id, collapsed = collapsed) }

  override suspend fun deleteCategory(id: String) = required { client.deleteCategory(id) }

  // Notes

  override suspend fun notes(): List<Note> = online({ cached().notes }) {
    client.notes().sortedByDescending { it.updatedAt }.also { n -> remember { it.copy(notes = n) } }
  }

  override suspend fun saveNote(article: Article, feedTitle: String?, body: String): Note = required {
    client.saveNote(article.id, article.displayTitle, article.url, feedTitle, body.take(ReaderBackend.NOTE_MAX))
  }

  override suspend fun deleteNote(id: String) = required { client.deleteNote(id) }

  // OPML

  override suspend fun exportOpml(): String = required { client.exportOpml() }

  override suspend fun importOpml(data: ByteArray): ImportResult {
    val r = required { client.importOpml(data) }
    return ImportResult(r.added, r.existing, r.categories)
  }

  /** Deletes the offline copy (signing out). */
  fun erase() {
    store.close()
    cacheFile.parentFile?.deleteRecursively()
  }

  private fun split(id: String): Pair<String, String>? {
    val i = id.indexOf(':')
    return if (i > 0) id.substring(0, i) to id.substring(i + 1) else null
  }
}

/**
 * The server's cursor for "after this article": base64url of the JSON
 * [publishedAt, feedId, id] (encodeCursor in the server's reader routes).
 */
internal fun articleCursor(a: Article): String {
  val published = if (a.publishedAt % 1.0 == 0.0) JsonPrimitive(a.publishedAt.toLong()) else JsonPrimitive(a.publishedAt)
  val tuple = JsonArray(listOf(published, JsonPrimitive(a.feedId), JsonPrimitive(a.articleId)))
  return Base64.getUrlEncoder().withoutPadding().encodeToString(tuple.toString().toByteArray())
}
