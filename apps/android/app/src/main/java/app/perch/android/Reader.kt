package app.perch.android

import android.content.Context
import app.perch.android.core.Article
import app.perch.android.core.Category
import app.perch.android.core.Feed
import app.perch.android.core.FullText
import app.perch.android.core.Library
import app.perch.android.core.StarterPack
import app.perch.android.core.StarterPacks
import app.perch.android.core.SyncedSettings
import app.perch.android.data.LocalBackend
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

/**
 * What the screens read and change: the library, unread counts and settings
 * as state, and the actions on them. Article lists load their own pages and
 * reload when [articlesChanged] moves.
 */
class Reader(
  private val context: Context,
  val backend: LocalBackend,
  private val scope: CoroutineScope,
  val device: DeviceSettings,
) {
  private val _library = MutableStateFlow(Library())
  val library: StateFlow<Library> = _library.asStateFlow()
  private val _unread = MutableStateFlow<Map<String, Int>>(emptyMap())
  val unread: StateFlow<Map<String, Int>> = _unread.asStateFlow()
  private val _starred = MutableStateFlow(0)
  val starred: StateFlow<Int> = _starred.asStateFlow()
  private val _settings = MutableStateFlow(SyncedSettings())
  val settings: StateFlow<SyncedSettings> = _settings.asStateFlow()
  private val _refreshing = MutableStateFlow(false)
  val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()
  private val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  /** Bumped when articles came or went (a refresh, a feed added or removed). */
  private val _articlesChanged = MutableStateFlow(0)
  val articlesChanged: StateFlow<Int> = _articlesChanged.asStateFlow()

  /** An article whose read or star state changed, for lists to update in place. */
  private val _updates = MutableSharedFlow<Article>(extraBufferCapacity = 64)
  val updates: SharedFlow<Article> = _updates

  val starterPacks: List<StarterPack> by lazy {
    val text = context.assets.open("starter-packs.json").bufferedReader().use { it.readText() }
    StarterPacks.forLanguage(StarterPacks.parse(text), Locale.getDefault().language)
  }

  val turkish: Boolean get() = Locale.getDefault().language == "tr"

  fun start() {
    scope.launch {
      _settings.value = backend.settings()
      reloadLibrary()
      _loaded.value = true
      if (_library.value.feeds.isNotEmpty()) refresh()
    }
  }

  private suspend fun reloadLibrary() {
    _library.value = backend.library()
    reloadCounts()
  }

  suspend fun reloadCounts() {
    _unread.value = backend.unreadCounts()
    _starred.value = backend.starredCount()
  }

  fun feed(id: String): Feed? = _library.value.feeds.firstOrNull { it.id == id }

  fun unreadTotal(): Int = _unread.value.values.sum()

  suspend fun refresh(ids: Collection<String>? = null) {
    if (_refreshing.value) return
    _refreshing.value = true
    try {
      backend.refresh(ids)
      reloadLibrary()
      _articlesChanged.value++
    } finally {
      _refreshing.value = false
    }
  }

  suspend fun addFeed(url: String, categoryId: String?): LocalBackend.AddResult {
    val result = backend.addFeed(url, categoryId)
    reloadLibrary()
    _articlesChanged.value++
    return result
  }

  /** Adds several feeds into one category (by name, made if missing); returns how many were new. */
  suspend fun addFeeds(urls: List<String>, category: String?): Int {
    val categoryId = category?.let { backend.addCategory(it).id }
    val gate = Semaphore(4)
    val added = kotlinx.coroutines.coroutineScope {
      urls.map { url ->
        async { gate.withPermit { runCatching { backend.addFeed(url, categoryId).created }.getOrDefault(false) } }
      }.awaitAll()
    }
    reloadLibrary()
    _articlesChanged.value++
    return added.count { it }
  }

  suspend fun removeFeed(id: String) {
    backend.removeFeed(id)
    reloadLibrary()
    _articlesChanged.value++
  }

  suspend fun renameFeed(id: String, title: String) {
    backend.updateFeed(id, customTitle = title)
    reloadLibrary()
  }

  suspend fun moveFeed(id: String, categoryId: String) {
    backend.updateFeed(id, categoryId = categoryId)
    reloadLibrary()
  }

  suspend fun addCategory(name: String): Category {
    val category = backend.addCategory(name)
    reloadLibrary()
    return category
  }

  suspend fun setCollapsed(categoryId: String, collapsed: Boolean) {
    backend.setCategoryCollapsed(categoryId, collapsed)
    reloadLibrary()
  }

  suspend fun deleteCategory(id: String) {
    backend.deleteCategory(id)
    reloadLibrary()
  }

  suspend fun setRead(articles: List<Article>, read: Boolean) {
    backend.setState(articles.map { it.id }, read = read)
    articles.forEach { _updates.tryEmit(it.copy(read = read)) }
    reloadCounts()
  }

  suspend fun setStarred(article: Article, starred: Boolean) {
    backend.setState(listOf(article.id), starred = starred)
    _updates.tryEmit(article.copy(starred = starred))
    reloadCounts()
  }

  suspend fun markAllRead(feed: String? = null, category: String? = null) {
    backend.markAllRead(feed, category)
    reloadCounts()
    _articlesChanged.value++
  }

  suspend fun fullText(article: Article, force: Boolean = false): FullText =
    (if (force) null else backend.cachedFullText(article)) ?: backend.fullText(article)

  suspend fun saveSettings(change: (SyncedSettings) -> SyncedSettings) {
    _settings.value = backend.saveSettings(change)
  }

  suspend fun importOpml(data: ByteArray): LocalBackend.ImportResult {
    val result = backend.importOpml(data)
    reloadLibrary()
    scope.launch { refresh() }
    return result
  }

  suspend fun exportOpml(): String = backend.exportOpml()
}
