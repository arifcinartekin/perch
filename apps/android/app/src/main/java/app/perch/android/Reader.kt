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
  val chain: ChainLink,
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

  /** A perch://chain link opened from outside, waiting for the screens to show it. */
  val pendingChainLink = MutableStateFlow<Pair<String, String>?>(null)

  val turkish: Boolean get() = Locale.getDefault().language == "tr"

  fun start() {
    scope.launch {
      chain.prepare()
      _settings.value = backend.settings()
      reloadLibrary()
      _loaded.value = true
      if (chain.account.value != null) syncChain()
      if (_library.value.feeds.isNotEmpty()) refresh()
    }
  }

  private var pendingSync: kotlinx.coroutines.Job? = null

  /** A change here: send it to the chain shortly, a burst of changes in one round. */
  private fun changed() {
    if (chain.account.value == null) return
    pendingSync?.cancel()
    pendingSync = scope.launch {
      kotlinx.coroutines.delay(1500)
      syncChain()
    }
  }

  /** One chain round; feeds added on another device are fetched right away. */
  suspend fun syncChain() {
    val result = chain.sync() ?: return
    _settings.value = backend.settings()
    if (result.pulled > 0) {
      reloadLibrary()
      _articlesChanged.value++
    }
    if (result.newFeedIds.isNotEmpty()) refresh(result.newFeedIds)
  }

  /**
   * Starts or joins a chain and runs the first round, in the app's scope:
   * the chain screen swaps its content as soon as the chain is set, which
   * would cancel work started from it. The caller awaits only the result.
   */
  suspend fun enterChain(action: suspend () -> Unit) = scope.async {
    action()
    afterChainChange()
    scope.launch { syncChain() }
  }.await()

  /** Joining, starting or leaving a chain changes the library; show what's there now. */
  suspend fun afterChainChange() {
    _settings.value = backend.settings()
    reloadLibrary()
    _articlesChanged.value++
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
    // Read state and new feeds from the other devices.
    if (ids == null && chain.account.value != null) syncChain()
  }

  suspend fun addFeed(url: String, categoryId: String?): LocalBackend.AddResult {
    val result = backend.addFeed(url, categoryId)
    reloadLibrary()
    _articlesChanged.value++
    changed()
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
    changed()
    return added.count { it }
  }

  suspend fun removeFeed(id: String) {
    backend.removeFeed(id)
    reloadLibrary()
    _articlesChanged.value++
    changed()
  }

  suspend fun renameFeed(id: String, title: String) {
    backend.updateFeed(id, customTitle = title)
    reloadLibrary()
    changed()
  }

  suspend fun moveFeed(id: String, categoryId: String) {
    backend.updateFeed(id, categoryId = categoryId)
    reloadLibrary()
    changed()
  }

  suspend fun addCategory(name: String): Category {
    val category = backend.addCategory(name)
    reloadLibrary()
    changed()
    return category
  }

  suspend fun setCollapsed(categoryId: String, collapsed: Boolean) {
    backend.setCategoryCollapsed(categoryId, collapsed)
    reloadLibrary()
    changed()
  }

  suspend fun deleteCategory(id: String) {
    backend.deleteCategory(id)
    reloadLibrary()
    changed()
  }

  suspend fun setRead(articles: List<Article>, read: Boolean) {
    backend.setState(articles.map { it.id }, read = read)
    articles.forEach { _updates.tryEmit(it.copy(read = read)) }
    reloadCounts()
    changed()
  }

  suspend fun setStarred(article: Article, starred: Boolean) {
    backend.setState(listOf(article.id), starred = starred)
    _updates.tryEmit(article.copy(starred = starred))
    reloadCounts()
    changed()
  }

  suspend fun markAllRead(feed: String? = null, category: String? = null) {
    backend.markAllRead(feed, category)
    reloadCounts()
    _articlesChanged.value++
    changed()
  }

  suspend fun fullText(article: Article, force: Boolean = false): FullText =
    (if (force) null else backend.cachedFullText(article)) ?: backend.fullText(article)

  suspend fun saveSettings(change: (SyncedSettings) -> SyncedSettings) {
    _settings.value = backend.saveSettings(change)
    changed()
  }

  suspend fun importOpml(data: ByteArray): LocalBackend.ImportResult {
    val result = backend.importOpml(data)
    reloadLibrary()
    scope.launch { refresh() }
    return result
  }

  suspend fun exportOpml(): String = backend.exportOpml()
}
