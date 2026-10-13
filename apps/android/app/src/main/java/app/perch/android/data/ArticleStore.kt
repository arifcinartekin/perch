package app.perch.android.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import app.perch.android.core.Article
import app.perch.android.core.Enclosure
import app.perch.android.core.FullText
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * The articles, on this device only: one SQLite table, plus extracted full
 * text for reading offline. The library itself (feeds, categories, settings)
 * is a JSON file next to it (LibraryFile).
 */
class ArticleStore(context: Context, name: String? = "articles.db") :
  SQLiteOpenHelper(context, name, null, 2) {

  data class Query(
    val feedIds: Set<String>? = null,
    val unreadOnly: Boolean = false,
    val starred: Boolean = false,
    val search: String = "",
  )

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE articles (
        id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, article_id TEXT NOT NULL, url TEXT,
        title TEXT NOT NULL, author TEXT, published_at REAL NOT NULL, summary TEXT, content TEXT,
        enclosures TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0
      )
      """,
    )
    db.execSQL("CREATE INDEX articles_feed ON articles(feed_id, published_at DESC)")
    db.execSQL("CREATE INDEX articles_published ON articles(published_at DESC)")
    db.execSQL("CREATE TABLE fulltext (id TEXT PRIMARY KEY, html TEXT NOT NULL, title TEXT, byline TEXT)")
    createPending(db)
  }

  override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
    if (old < 2) createPending(db)
  }

  /** Read and star changes waiting to go out to the sync chain (null = unchanged). */
  private fun createPending(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE pending (id TEXT PRIMARY KEY, read INTEGER, starred INTEGER, seq INTEGER NOT NULL)")
  }

  data class Pending(val id: String, val read: Boolean?, val starred: Boolean?, val seq: Long)

  private var seq = System.nanoTime()

  fun enqueue(id: String, read: Boolean? = null, starred: Boolean? = null) {
    val db = writableDatabase
    val old = pending().firstOrNull { it.id == id }
    db.insertWithOnConflict(
      "pending", null,
      ContentValues().apply {
        put("id", id)
        (read ?: old?.read)?.let { put("read", if (it) 1 else 0) }
        (starred ?: old?.starred)?.let { put("starred", if (it) 1 else 0) }
        put("seq", ++seq)
      },
      SQLiteDatabase.CONFLICT_REPLACE,
    )
  }

  fun pending(): List<Pending> =
    readableDatabase.rawQuery("SELECT id, read, starred, seq FROM pending", null).use { c ->
      generateSequence {
        if (!c.moveToNext()) null
        else Pending(
          c.getString(0),
          if (c.isNull(1)) null else c.getInt(1) != 0,
          if (c.isNull(2)) null else c.getInt(2) != 0,
          c.getLong(3),
        )
      }.toList()
    }

  /** Clears these entries unless they changed again since (a newer seq). */
  fun clearPending(entries: List<Pending>) {
    val db = writableDatabase
    for (e in entries) db.delete("pending", "id = ? AND seq = ?", arrayOf(e.id, e.seq.toString()))
  }

  fun clearAllPending() {
    writableDatabase.delete("pending", null, null)
  }

  override fun onConfigure(db: SQLiteDatabase) {
    db.enableWriteAheadLogging()
    // Deleted articles don't linger in the file.
    db.rawQuery("PRAGMA secure_delete = ON", null).use { it.moveToFirst() }
  }

  private val enclosuresJson = ListSerializer(Enclosure.serializer())

  /** Adds articles not seen before; existing ones keep their read and star state. */
  fun insertNew(articles: List<Article>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      for (a in articles) {
        db.insertWithOnConflict(
          "articles", null,
          ContentValues().apply {
            put("id", a.id); put("feed_id", a.feedId); put("article_id", a.articleId)
            put("url", a.url); put("title", a.title); put("author", a.author)
            put("published_at", a.publishedAt); put("summary", a.summaryHtml); put("content", a.contentHtml)
            put("enclosures", Json.encodeToString(enclosuresJson, a.enclosures))
          },
          SQLiteDatabase.CONFLICT_IGNORE,
        )
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /**
   * Stores articles as a server sent them, read and star state included (the
   * offline copy of a library on a Perch Server).
   */
  fun upsert(articles: List<Article>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      for (a in articles) {
        db.insertWithOnConflict(
          "articles", null,
          ContentValues().apply {
            put("id", a.id); put("feed_id", a.feedId); put("article_id", a.articleId)
            put("url", a.url); put("title", a.title); put("author", a.author)
            put("published_at", a.publishedAt); put("summary", a.summaryHtml); put("content", a.contentHtml)
            put("enclosures", Json.encodeToString(enclosuresJson, a.enclosures))
            put("read", if (a.read) 1 else 0); put("starred", if (a.starred) 1 else 0)
          },
          SQLiteDatabase.CONFLICT_REPLACE,
        )
      }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /** Newest first; [before] is the last page's oldest `publishedAt`. */
  fun articles(q: Query, before: Double?, limit: Int): List<Article> {
    val where = mutableListOf<String>()
    val args = mutableListOf<String>()
    q.feedIds?.let { ids ->
      if (ids.isEmpty()) return emptyList()
      where += "feed_id IN (${ids.joinToString(",") { "?" }})"
      args += ids
    }
    if (q.unreadOnly) where += "read = 0"
    if (q.starred) where += "starred = 1"
    if (q.search.isNotBlank()) {
      where += "(title LIKE ? OR summary LIKE ? OR content LIKE ?)"
      val like = "%${q.search.trim()}%"
      args += listOf(like, like, like)
    }
    if (before != null) {
      where += "published_at < ?"
      args += before.toString()
    }
    val sql = "SELECT * FROM articles" +
      (if (where.isEmpty()) "" else " WHERE " + where.joinToString(" AND ")) +
      " ORDER BY published_at DESC LIMIT $limit"
    return readableDatabase.rawQuery(sql, args.toTypedArray()).use { c -> generateSequence { if (c.moveToNext()) c.article() else null }.toList() }
  }

  fun article(id: String): Article? =
    readableDatabase.rawQuery("SELECT * FROM articles WHERE id = ?", arrayOf(id)).use { c ->
      if (c.moveToFirst()) c.article() else null
    }

  fun setState(id: String, read: Boolean?, starred: Boolean?) {
    val values = ContentValues()
    read?.let { values.put("read", if (it) 1 else 0) }
    starred?.let { values.put("starred", if (it) 1 else 0) }
    if (values.size() > 0) writableDatabase.update("articles", values, "id = ?", arrayOf(id))
  }

  /** Marks unread articles read; returns their ids. */
  fun markRead(feedIds: Set<String>?, upTo: Double): List<String> {
    val where = StringBuilder("read = 0 AND published_at <= ?")
    val args = mutableListOf(upTo.toString())
    feedIds?.let { ids ->
      if (ids.isEmpty()) return emptyList()
      where.append(" AND feed_id IN (${ids.joinToString(",") { "?" }})")
      args += ids
    }
    val db = writableDatabase
    val ids = db.rawQuery("SELECT id FROM articles WHERE $where", args.toTypedArray()).use { c ->
      generateSequence { if (c.moveToNext()) c.getString(0) else null }.toList()
    }
    db.update("articles", ContentValues().apply { put("read", 1) }, where.toString(), args.toTypedArray())
    return ids
  }

  fun unreadCounts(): Map<String, Int> =
    readableDatabase.rawQuery("SELECT feed_id, COUNT(*) FROM articles WHERE read = 0 GROUP BY feed_id", null)
      .use { c -> buildMap { while (c.moveToNext()) put(c.getString(0), c.getInt(1)) } }

  fun starredCount(): Int =
    readableDatabase.rawQuery("SELECT COUNT(*) FROM articles WHERE starred = 1", null).use { c ->
      if (c.moveToFirst()) c.getInt(0) else 0
    }

  /** Drops articles older than [before], except starred ones. */
  fun prune(before: Double) {
    writableDatabase.delete("articles", "published_at < ? AND starred = 0", arrayOf(before.toString()))
    cleanFullText()
  }

  fun deleteArticles(feedId: String, keepStarred: Boolean) {
    writableDatabase.delete(
      "articles", if (keepStarred) "feed_id = ? AND starred = 0" else "feed_id = ?", arrayOf(feedId),
    )
    cleanFullText()
  }

  fun deleteArticles(notIn: Set<String>, keepStarred: Boolean) {
    val placeholders = notIn.joinToString(",") { "?" }
    val where = (if (notIn.isEmpty()) "1 = 1" else "feed_id NOT IN ($placeholders)") +
      (if (keepStarred) " AND starred = 0" else "")
    writableDatabase.delete("articles", where, notIn.toTypedArray())
    cleanFullText()
  }

  fun fullText(id: String): FullText? =
    readableDatabase.rawQuery("SELECT html, title, byline FROM fulltext WHERE id = ?", arrayOf(id)).use { c ->
      if (c.moveToFirst()) FullText(c.getString(0), c.getString(1), c.getString(2)) else null
    }

  fun saveFullText(id: String, text: FullText) {
    writableDatabase.insertWithOnConflict(
      "fulltext", null,
      ContentValues().apply { put("id", id); put("html", text.html); put("title", text.title); put("byline", text.byline) },
      SQLiteDatabase.CONFLICT_REPLACE,
    )
  }

  fun clearFullText() {
    writableDatabase.delete("fulltext", null, null)
  }

  private fun cleanFullText() {
    writableDatabase.execSQL("DELETE FROM fulltext WHERE id NOT IN (SELECT id FROM articles)")
  }

  private fun Cursor.article(): Article {
    fun s(col: String) = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getString(it) }
    return Article(
      articleId = s("article_id")!!,
      feedId = s("feed_id")!!,
      url = s("url"),
      title = s("title").orEmpty(),
      author = s("author"),
      publishedAt = getDouble(getColumnIndexOrThrow("published_at")),
      summaryHtml = s("summary"),
      contentHtml = s("content"),
      enclosures = runCatching { Json.decodeFromString(enclosuresJson, s("enclosures") ?: "[]") }.getOrDefault(emptyList()),
      read = getInt(getColumnIndexOrThrow("read")) != 0,
      starred = getInt(getColumnIndexOrThrow("starred")) != 0,
    )
  }
}

/** A list's page from the store: the feeds a [library] follows, narrowed like ReaderBackend.articles. */
internal fun ArticleStore.list(
  library: app.perch.android.core.Library,
  scope: ReaderBackend.Scope,
  feed: String?,
  category: String?,
  unreadOnly: Boolean,
  search: String,
  before: Article?,
  limit: Int,
): List<Article> {
  var feedIds: Set<String>? = if (scope == ReaderBackend.Scope.STARRED) null else library.feeds.map { it.id }.toSet()
  if (feed != null) feedIds = setOf(feed)
  if (category != null) feedIds = library.feeds.filter { it.categoryId == category }.map { it.id }.toSet()
  return articles(ArticleStore.Query(feedIds, unreadOnly, scope == ReaderBackend.Scope.STARRED, search), before?.publishedAt, limit)
}
