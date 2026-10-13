package app.perch.android.data

import app.perch.android.core.Article
import app.perch.android.core.Category
import app.perch.android.core.Feed
import app.perch.android.core.FeedDiscovery
import app.perch.android.core.FeedIds
import app.perch.android.core.FeedParser
import app.perch.android.core.FullText
import app.perch.android.core.HtmlText
import app.perch.android.core.Library
import app.perch.android.core.NotAFeedException
import app.perch.android.core.Note
import app.perch.android.core.Opml
import app.perch.android.core.ParsedFeed
import app.perch.android.core.Readability
import app.perch.android.core.SyncedSettings
import app.perch.android.core.UNCATEGORIZED_ID
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * The library kept entirely on this device: the phone fetches the feeds
 * itself, like the browser extension and the iPhone app do. Feeds,
 * categories and settings are one JSON file; the articles are rows in
 * [ArticleStore], and this is the only copy of them.
 */
class LocalBackend(
  internal val store: ArticleStore,
  private val file: File,
  client: OkHttpClient? = null,
) : ReaderBackend {
  sealed class Failure(message: String) : Exception(message) {
    /** The address gave neither a feed nor a page that names one. */
    class NoFeed : Failure("No feed found at that address")
    class BadAddress : Failure("That isn't a web address")
    class Unreachable(why: String) : Failure(why)
    /** Full text: the page had nothing that looked like an article. */
    class NoArticleText : Failure("Couldn't find the article on the page")
  }

  @Serializable
  data class Validators(val etag: String? = null, val lastModified: String? = null)

  @Serializable
  data class Saved(
    val library: Library = Library(),
    val settings: SyncedSettings = SyncedSettings(),
    /** Per feed: validators for conditional requests. */
    val validators: Map<String, Validators> = emptyMap(),
    /** Notes on articles, by "feedId:articleId". */
    val notes: Map<String, Note> = emptyMap(),
  )

  companion object {
    const val NOTE_MAX = ReaderBackend.NOTE_MAX
    /** Articles older than this are dropped (starred ones stay). */
    const val KEEP_DAYS = 60.0
    private const val DAY_MS = 86_400_000.0
    private const val ACCEPT =
      "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8"
  }

  // Feeds are fetched without cookies or a shared cache, so sites can't tie
  // the requests together.
  private val http = client ?: OkHttpClient.Builder()
    .callTimeout(25, TimeUnit.SECONDS)
    .connectTimeout(15, TimeUnit.SECONDS)
    .followRedirects(true)
    .addInterceptor { chain ->
      chain.proceed(chain.request().newBuilder().header("User-Agent", "Perch/1.0 (feed reader; Android)").build())
    }
    .build()

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
  private val lock = Mutex()
  private var state: Saved? = null

  /** In a sync chain: read and star changes are queued to go out. */
  @Volatile var chainOn = false

  /** Runs after articles arrive, so chain states for them can be applied (set by ChainSync). */
  internal var afterArticles: (suspend () -> Unit)? = null

  internal suspend fun load(): Saved = lock.withLock { loadLocked() }

  private fun loadLocked(): Saved {
    state?.let { return it }
    val saved = runCatching { json.decodeFromString<Saved>(file.readText()) }.getOrDefault(Saved())
    state = saved
    return saved
  }

  internal suspend fun update(change: (Saved) -> Saved): Saved = lock.withLock {
    val next = change(loadLocked())
    state = next
    withContext(Dispatchers.IO) {
      val tmp = File(file.parentFile, file.name + ".tmp")
      tmp.writeText(json.encodeToString(Saved.serializer(), next))
      tmp.renameTo(file)
    }
    next
  }

  // Library

  override suspend fun library(): Library = load().library
  override suspend fun settings(): SyncedSettings = load().settings

  override suspend fun saveSettings(change: (SyncedSettings) -> SyncedSettings): SyncedSettings =
    update { it.copy(settings = change(it.settings)) }.settings

  override suspend fun unreadCounts(): Map<String, Int> {
    val feeds = library().feeds.map { it.id }.toSet()
    return withContext(Dispatchers.IO) { store.unreadCounts().filterKeys { it in feeds } }
  }

  override suspend fun starredCount(): Int = withContext(Dispatchers.IO) { store.starredCount() }

  // Articles

  /** Lists show the feeds you follow; starred articles stay after their feed is removed. */
  override suspend fun articles(
    scope: ReaderBackend.Scope,
    feed: String?,
    category: String?,
    unreadOnly: Boolean,
    search: String,
    before: Article?,
    limit: Int,
  ): List<Article> {
    val library = library()
    return withContext(Dispatchers.IO) { store.list(library, scope, feed, category, unreadOnly, search, before, limit) }
  }

  override suspend fun article(id: String): Article? = withContext(Dispatchers.IO) { store.article(id) }

  override suspend fun setState(ids: List<String>, read: Boolean?, starred: Boolean?) =
    withContext(Dispatchers.IO) {
      ids.forEach {
        store.setState(it, read, starred)
        if (chainOn) store.enqueue(it, read, starred)
      }
    }

  override suspend fun markAllRead(feed: String?, category: String?) {
    var ids: Set<String>? = null
    if (feed != null) ids = setOf(feed)
    if (category != null) ids = library().feeds.filter { it.categoryId == category }.map { it.id }.toSet()
    withContext(Dispatchers.IO) {
      val marked = store.markRead(ids, System.currentTimeMillis().toDouble())
      if (chainOn) marked.forEach { store.enqueue(it, read = true) }
    }
  }

  override suspend fun cachedFullText(article: Article): FullText? = withContext(Dispatchers.IO) { store.fullText(article.id) }

  override suspend fun fullText(article: Article, force: Boolean): FullText {
    val url = article.url?.takeIf { it.startsWith("http") } ?: throw Failure.NoArticleText()
    val text = withContext(Dispatchers.IO) {
      get(url).use { Readability.extract(decode(it.body.bytes())) }
    } ?: throw Failure.NoArticleText()
    withContext(Dispatchers.IO) { store.saveFullText(article.id, text) }
    return text
  }

  // Fetching

  /** Fetches feeds a few at a time and adds new articles. A feed that fails keeps its articles. */
  override suspend fun refresh(ids: Collection<String>?) {
    val s = load()
    val feeds = s.library.feeds.filter { ids == null || it.id in ids }
    val gate = Semaphore(6)
    val results = coroutineScope {
      feeds.map { feed ->
        async(Dispatchers.IO) {
          gate.withPermit { feed to runCatching { fetch(feed, s.validators[feed.id]) } }
        }
      }.awaitAll()
    }
    val now = System.currentTimeMillis().toDouble()
    // A feed removed while it was being fetched must not get its articles back.
    val subscribed = library().feeds.map { it.id }.toSet()
    val updated = mutableMapOf<String, Feed>()
    val newValidators = mutableMapOf<String, Validators>()
    for ((feed, result) in results) {
      if (feed.id !in subscribed) continue
      var f = feed.copy(lastFetchedAt = now)
      result.fold(
        onSuccess = { fetched ->
          f = f.copy(lastError = null)
          if (fetched != null) {
            if (fetched.first.title.isNotEmpty()) f = f.copy(title = fetched.first.title)
            fetched.first.siteUrl?.let { f = f.copy(siteUrl = it) }
            newValidators[feed.id] = fetched.second
            withContext(Dispatchers.IO) { store.insertNew(articlesOf(fetched.first, feed.id)) }
          }
        },
        onFailure = { f = f.copy(lastError = describe(it)) },
      )
      updated[feed.id] = f
    }
    withContext(Dispatchers.IO) {
      store.prune(now - KEEP_DAYS * DAY_MS)
      store.deleteArticles(notIn = library().feeds.map { it.id }.toSet(), keepStarred = true)
    }
    update { saved ->
      saved.copy(
        library = saved.library.copy(feeds = saved.library.feeds.map { updated[it.id] ?: it }),
        validators = saved.validators + newValidators,
      )
    }
    afterArticles?.invoke()
  }

  /** null when the feed hasn't changed since last time (304). */
  private fun fetch(feed: Feed, validators: Validators?): Pair<ParsedFeed, Validators>? {
    val request = Request.Builder().url(feed.url).header("Accept", ACCEPT).apply {
      validators?.etag?.let { header("If-None-Match", it) }
      validators?.lastModified?.let { header("If-Modified-Since", it) }
    }.build()
    http.newCall(request).execute().use { response ->
      if (response.code == 304) return null
      check(response)
      val parsed = FeedParser.parse(response.body.bytes(), response.request.url.toString())
      return parsed to validatorsOf(response)
    }
  }

  private fun articlesOf(feed: ParsedFeed, feedId: String): List<Article> {
    val now = System.currentTimeMillis().toDouble()
    val oldest = now - KEEP_DAYS * DAY_MS
    return feed.items.mapNotNull { item ->
      // Undated items count as new when first seen; their id leaves the date
      // out so they don't come back every time.
      val published = item.published?.toDouble()
      val at = minOf(published ?: now, now)
      if (at < oldest) return@mapNotNull null
      Article(
        articleId = FeedIds.article(feedId, item, published ?: 0.0),
        feedId = feedId,
        url = item.url,
        title = item.title,
        author = item.author,
        publishedAt = at,
        summaryHtml = item.summaryHtml?.let(HtmlText::sanitize),
        contentHtml = item.contentHtml?.let(HtmlText::sanitize),
        enclosures = item.enclosures,
      )
    }
  }

  // Library management

  /** Takes a feed's address or a site's (finding the feed it names, or one at a usual place). */
  override suspend fun addFeed(input: String, categoryId: String?): AddResult {
    var text = input.trim()
    if (!text.contains("://")) text = "https://$text"
    val url = text.toHttpUrlOrNull() ?: throw Failure.BadAddress()
    val (feedUrl, parsed, validators) = withContext(Dispatchers.IO) { discover(url) }
    val id = FeedIds.feed(feedUrl)
    library().feeds.firstOrNull { it.id == id }?.let { return AddResult(it, false) }
    val category = if (library().categories.any { it.id == categoryId }) categoryId!! else UNCATEGORIZED_ID
    val now = System.currentTimeMillis().toDouble()
    val feed = Feed(
      id = id, url = feedUrl, title = parsed.title, siteUrl = parsed.siteUrl ?: url,
      categoryId = category, addedAt = now, lastFetchedAt = now,
    )
    withContext(Dispatchers.IO) { store.insertNew(articlesOf(parsed, id)) }
    update { s ->
      s.copy(
        library = s.library.copy(feeds = s.library.feeds + feed),
        validators = s.validators + (id to validators),
      )
    }
    afterArticles?.invoke()
    return AddResult(feed, true)
  }

  /** The feed at [url], or the one the page there names, or one at a usual place on the site. */
  private fun discover(url: String): Triple<String, ParsedFeed, Validators> {
    get(url).use { response ->
      val final = response.request.url.toString()
      val data = response.body.bytes()
      runCatching { FeedParser.parse(data, final) }.getOrNull()?.let {
        return Triple(final, it, validatorsOf(response))
      }
      for (candidate in FeedDiscovery.links(decode(data), final) + FeedDiscovery.guesses(final)) {
        val found = runCatching {
          get(candidate).use { r ->
            val at = r.request.url.toString()
            Triple(at, FeedParser.parse(r.body.bytes(), at), validatorsOf(r))
          }
        }.getOrNull()
        if (found != null) return found
      }
    }
    throw Failure.NoFeed()
  }

  override suspend fun removeFeed(id: String) {
    update { s ->
      s.copy(library = s.library.copy(feeds = s.library.feeds.filterNot { it.id == id }), validators = s.validators - id)
    }
    withContext(Dispatchers.IO) { store.deleteArticles(id, keepStarred = true) }
  }

  override suspend fun updateFeed(id: String, categoryId: String?, customTitle: String?) {
    update { s ->
      s.copy(
        library = s.library.copy(
          feeds = s.library.feeds.map { f ->
            if (f.id != id) f else f.copy(
              categoryId = categoryId ?: f.categoryId,
              customTitle = if (customTitle != null) customTitle.ifEmpty { null } else f.customTitle,
            )
          },
        ),
      )
    }
  }

  override suspend fun addCategory(name: String): Category {
    val trimmed = name.trim()
    library().categories.firstOrNull { it.name.equals(trimmed, ignoreCase = true) }?.let { return it }
    val order = (library().categories.map { it.order }.filter { it < 1000 }.maxOrNull() ?: 0.0) + 10
    val category = Category(newId(), trimmed, order)
    update { s -> s.copy(library = s.library.copy(categories = s.library.categories + category)) }
    return category
  }

  override suspend fun setCategoryCollapsed(id: String, collapsed: Boolean) {
    update { s ->
      var categories = s.library.categories
      if (categories.none { it.id == id } && id == UNCATEGORIZED_ID) {
        categories = categories + Category(id, "Uncategorized", 1_000_000.0)
      }
      s.copy(library = s.library.copy(categories = categories.map { if (it.id == id) it.copy(collapsed = collapsed) else it }))
    }
  }

  override suspend fun deleteCategory(id: String) {
    if (id == UNCATEGORIZED_ID) return
    update { s ->
      s.copy(
        library = s.library.copy(
          categories = s.library.categories.filterNot { it.id == id },
          feeds = s.library.feeds.map { if (it.categoryId == id) it.copy(categoryId = UNCATEGORIZED_ID) else it },
        ),
      )
    }
  }

  // Notes

  override suspend fun notes(): List<Note> = load().notes.values.sortedByDescending { it.updatedAt }

  override suspend fun note(id: String): Note? = load().notes[id]

  override suspend fun saveNote(article: Article, feedTitle: String?, body: String): Note {
    val now = System.currentTimeMillis().toDouble()
    var saved: Note? = null
    update { s ->
      val existing = s.notes[article.id]
      val note = Note(
        feedId = article.feedId, articleId = article.articleId, title = article.displayTitle,
        url = article.url, feedTitle = feedTitle, body = body.take(NOTE_MAX),
        createdAt = existing?.createdAt ?: now, updatedAt = now, sharedUrl = existing?.sharedUrl,
      )
      saved = note
      s.copy(notes = s.notes + (article.id to note))
    }
    return saved!!
  }

  override suspend fun deleteNote(id: String) {
    update { s -> s.copy(notes = s.notes - id) }
  }

  /** Records (or clears) a note's public link; it syncs with the rest of the note. */
  suspend fun setSharedUrl(id: String, url: String?) {
    update { s -> s.notes[id]?.let { s.copy(notes = s.notes + (id to it.copy(sharedUrl = url))) } ?: s }
  }

  // OPML

  override suspend fun exportOpml(): String = Opml.build(library())

  /** Adds the list's feeds (fetched by the next refresh) and their categories. */
  override suspend fun importOpml(data: ByteArray): ImportResult {
    var added = 0
    var existing = 0
    var categories = 0
    for (outline in Opml.parse(data)) {
      val url = outline.url.trim()
      if (!(url.startsWith("http://") || url.startsWith("https://"))) continue
      val id = FeedIds.feed(url)
      if (library().feeds.any { it.id == id }) {
        existing++
        continue
      }
      var categoryId = UNCATEGORIZED_ID
      outline.category?.let { name ->
        val before = library().categories.size
        categoryId = addCategory(name).id
        if (library().categories.size > before) categories++
      }
      val feed = Feed(
        id = id, url = url, title = outline.title.orEmpty(), categoryId = categoryId,
        addedAt = System.currentTimeMillis().toDouble(),
      )
      update { s -> s.copy(library = s.library.copy(feeds = s.library.feeds + feed)) }
      added++
    }
    return ImportResult(added, existing, categories)
  }

  // Plumbing

  private fun get(url: String): Response {
    val response = try {
      http.newCall(Request.Builder().url(url).header("Accept", ACCEPT).build()).execute()
    } catch (e: IllegalArgumentException) {
      throw Failure.BadAddress()
    }
    try {
      check(response)
    } catch (e: Exception) {
      response.close()
      throw e
    }
    return response
  }

  private fun check(response: Response) {
    if (!response.isSuccessful) throw Failure.Unreachable("${response.code} ${response.message}".trim())
  }

  private fun validatorsOf(response: Response) =
    Validators(response.header("ETag"), response.header("Last-Modified"))

  private fun describe(error: Throwable): String = when (error) {
    is Failure -> error.message.orEmpty()
    is NotAFeedException -> "Not a feed"
    is IOException -> error.message ?: "Couldn't reach the site"
    else -> error.message ?: error.toString()
  }

  /** Pages are usually UTF-8; Latin-1 keeps any bytes readable otherwise. */
  private fun decode(data: ByteArray): String {
    val utf8 = data.decodeToString()
    return if (utf8.contains('�')) String(data, Charsets.ISO_8859_1) else utf8
  }

  private fun newId(): String {
    val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    return (1..8).map { chars.random() }.joinToString("")
  }

  private fun String.toHttpUrlOrNull(): String? {
    val parsed = runCatching { java.net.URI(this) }.getOrNull() ?: return null
    if (parsed.scheme != "http" && parsed.scheme != "https") return null
    if (parsed.host.isNullOrEmpty()) return null
    return if (parsed.rawPath.isNullOrEmpty()) "$this/" else this
  }
}
