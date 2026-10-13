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
import app.perch.android.data.AddResult
import app.perch.android.data.ApiClient
import app.perch.android.data.ImportResult
import app.perch.android.data.LocalBackend
import app.perch.android.data.ReaderBackend
import app.perch.android.data.ServerBackend
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
 * reload when [articlesChanged] moves. The library is on the phone (and syncs
 * by chain) or on a Perch Server ([server], personal mode); a new Reader
 * opens when that changes.
 */
class Reader(
  private val context: Context,
  val backend: ReaderBackend,
  appScope: CoroutineScope,
  val device: DeviceSettings,
  val chain: ChainLink,
  val community: Community,
) {
  /** The library's server, when it isn't on the phone. */
  val server: ServerBackend? = backend as? ServerBackend
  val isLocal: Boolean get() = server == null
  private val job = kotlinx.coroutines.SupervisorJob(appScope.coroutineContext[kotlinx.coroutines.Job])
  private val scope = CoroutineScope(appScope.coroutineContext + job)

  /** Another library opened: stop listening and close this one's files. */
  fun close() {
    job.cancel()
    server?.store?.close()
  }

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

  /** An article opened from the widget or a notification. */
  val pendingArticle = MutableStateFlow<String?>(null)

  /** The widget or a notification asked for the unread list. */
  val pendingUnread = MutableStateFlow(false)

  /** A page shared to Perch from another app, to add its feed. */
  val pendingAddUrl = MutableStateFlow<String?>(null)

  val turkish: Boolean get() = Locale.getDefault().language == "tr"

  fun start() {
    scope.launch {
      if (isLocal) chain.prepare()
      runCatching {
        _settings.value = backend.settings()
        reloadLibrary()
        reloadNotes()
      }
      _loaded.value = true
      if (isLocal && chain.account.value != null) syncChain()
      if (_library.value.feeds.isNotEmpty()) runCatching { refresh() }
    }
    if (server != null) scope.launch { listen(server) }
  }

  /**
   * Follows the server's event stream while the app runs: the account changed
   * somewhere (library, read state, settings, notes) or new articles arrived.
   * Reconnects with a growing pause when the connection drops.
   */
  private suspend fun listen(server: ServerBackend) {
    var pause = 1_000L
    var last: String? = null
    while (true) {
      try {
        server.client.events().collect { event ->
          pause = 1_000L
          when (event) {
            is ApiClient.Event.Cursor -> {
              // The first cursor only says where we are; later ones mean a change.
              if (last != null && last != event.value) reloadFromServer()
              last = event.value
            }
            ApiClient.Event.Articles -> {
              reloadCounts()
              _articlesChanged.value++
              keepOffline()
            }
          }
        }
      } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
      } catch (e: app.perch.android.data.ApiError) {
        if (e.status == 401) {
          server.onUnauthorized?.invoke()
          return
        }
      } catch (_: Exception) {
      }
      kotlinx.coroutines.delay(pause)
      pause = minOf(pause * 2, 60_000L)
    }
  }

  private suspend fun reloadFromServer() = runCatching {
    _settings.value = backend.settings()
    reloadLibrary()
    reloadNotes()
    _articlesChanged.value++
  }

  /** With the library on a server: the newest unread and every starred article stay on the phone. */
  private fun keepOffline() {
    val server = server ?: return
    if (!device.offlineEnabled.value) return
    scope.launch { runCatching { server.downloadForOffline(device.offlineLimit.value) } }
  }

  private var pendingSync: kotlinx.coroutines.Job? = null

  /** A change here: send it to the chain shortly, a burst of changes in one round. */
  private fun changed() {
    if (!isLocal || chain.account.value == null) return
    pendingSync?.cancel()
    pendingSync = scope.launch {
      kotlinx.coroutines.delay(1500)
      syncChain()
    }
  }

  /** One chain round; feeds added on another device are fetched right away. */
  suspend fun syncChain() {
    if (!isLocal) return
    val result = chain.sync() ?: return
    _settings.value = backend.settings()
    if (result.pulled > 0) {
      reloadLibrary()
      reloadNotes()
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
    reloadNotes()
    _articlesChanged.value++
  }

  private suspend fun reloadLibrary() {
    _library.value = backend.library()
    reloadCounts()
  }

  suspend fun reloadCounts() {
    _unread.value = backend.unreadCounts()
    _starred.value = backend.starredCount()
    // The widget follows what's read here, without notifying about it.
    scope.launch { app.perch.android.widget.Headlines.update(context, notify = false) }
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
    if (isLocal && ids == null && chain.account.value != null) syncChain()
    if (ids == null) keepOffline()
  }

  suspend fun addFeed(url: String, categoryId: String?): AddResult {
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
    (if (force) null else backend.cachedFullText(article)) ?: backend.fullText(article, force)

  suspend fun saveSettings(change: (SyncedSettings) -> SyncedSettings) {
    _settings.value = backend.saveSettings(change)
    changed()
  }

  // Notes and sharing

  private val _notes = MutableStateFlow<List<app.perch.android.core.Note>>(emptyList())
  val notes: StateFlow<List<app.perch.android.core.Note>> = _notes.asStateFlow()

  suspend fun reloadNotes() {
    _notes.value = backend.notes()
  }

  /** Saves a note; a shared one's public page follows it. */
  suspend fun saveNote(article: Article, body: String): app.perch.android.core.Note {
    val note = backend.saveNote(article, feed(article.feedId)?.displayTitle, body)
    reloadNotes()
    changed()
    // A shared note's public page follows it (a server holding the library updates its own).
    if (isLocal && note.sharedUrl != null) scope.launch { runCatching { community.client()?.shareNote(note) } }
    return note
  }

  /** Deletes a note, taking its public page down first. */
  suspend fun deleteNote(id: String) {
    val note = backend.note(id)
    if (note?.sharedUrl != null) runCatching { (server?.client ?: pageClient(note.sharedUrl))?.unshareNote(id) }
    backend.deleteNote(id)
    reloadNotes()
    changed()
  }

  /** Publishes the note as a public page through the Perch account; returns its address. */
  suspend fun shareNote(id: String): String {
    // A library on a server shares through that server, which records the link.
    server?.let {
      val url = it.client.shareStoredNote(id)
      reloadNotes()
      return url
    }
    val local = backend as LocalBackend
    val note = backend.note(id) ?: error("Save the note before sharing it.")
    val client = community.client() ?: throw IllegalStateException("no-account")
    val url = client.shareNote(note)
    local.setSharedUrl(id, url)
    reloadNotes()
    changed()
    return url
  }

  suspend fun unshareNote(id: String) {
    val note = backend.note(id) ?: return
    val url = note.sharedUrl ?: return
    server?.let {
      it.client.unshareNote(id)
      reloadNotes()
      return
    }
    (pageClient(url) ?: throw IllegalStateException("other-account")).unshareNote(id)
    (backend as LocalBackend).setSharedUrl(id, null)
    reloadNotes()
    changed()
  }

  /** The account a page lives on: the Perch account, when the page is on its server. */
  private fun pageClient(url: String): app.perch.android.data.ApiClient? {
    val account = community.account.value ?: return null
    val host = runCatching { java.net.URI(url).host }.getOrNull()
    val mine = runCatching { java.net.URI(account.server).host }.getOrNull()
    return if (host == mine) community.client() else null
  }

  suspend fun importOpml(data: ByteArray): ImportResult {
    val result = backend.importOpml(data)
    reloadLibrary()
    scope.launch { refresh() }
    return result
  }

  suspend fun exportOpml(): String = backend.exportOpml()
}
