package app.perch.android.data

import app.perch.android.core.Article
import app.perch.android.core.Category
import app.perch.android.core.Enclosure
import app.perch.android.core.Feed
import app.perch.android.core.FullText
import app.perch.android.core.KdfParams
import app.perch.android.core.Library
import app.perch.android.core.SyncedSettings
import app.perch.android.core.KeyDerivation
import app.perch.android.core.Note
import app.perch.android.core.ProofOfWork
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** An error from a Perch Server: its code ("username-taken") and message. */
class ApiError(val status: Int, val code: String, message: String) : Exception(message)

/**
 * The Perch Server API (/api/v1): sign-in, sign-up with proof of work, an
 * invite or an emailed code and a recovery code; sharing notes; and, for a
 * library on the server (personal mode), the reader API and its event stream.
 * The password never leaves the phone; only the key derived from it does
 * (KeyDerivation).
 */
class ApiClient(val server: String, private val token: String? = null) {
  @Serializable
  data class ServerInfo(
    val software: String = "",
    val version: String = "",
    val mode: String = "personal",
    val signup: String = "closed",
    /** No accounts yet: the first one to register becomes the admin. */
    val needsSetup: Boolean = false,
    /** The server can email codes (signup, password reset). */
    val email: Boolean? = null,
    val chain: Boolean? = null,
    val pow: Int? = null,
    val recovery: Boolean? = null,
    val accountUrl: String? = null,
    val legal: Legal? = null,
  )

  @Serializable data class Legal(val privacy: String? = null, val terms: String? = null)

  @Serializable
  data class User(
    val id: String,
    val username: String,
    val role: String = "user",
    val hasRecovery: Boolean? = null,
    val hasEmail: Boolean? = null,
  )

  @Serializable
  data class Device(val id: String, val name: String, val createdAt: Double = 0.0, val lastSeenAt: Double = 0.0, val current: Boolean = false)

  @Serializable
  data class Invite(val code: String, val createdAt: Double = 0.0, val usedBy: String? = null, val usedAt: Double? = null)

  /** An article as the server sends it: its own id, and 0/1 or true/false for the flags. */
  @Serializable
  data class ServerArticle(
    val id: String,
    val feedId: String,
    val url: String? = null,
    val title: String = "",
    val author: String? = null,
    val publishedAt: Double,
    val summaryHtml: String? = null,
    val contentHtml: String? = null,
    val enclosures: List<Enclosure> = emptyList(),
    val read: JsonElement? = null,
    val starred: JsonElement? = null,
  ) {
    fun toArticle() = Article(id, feedId, url, title, author, publishedAt, summaryHtml, contentHtml, enclosures, flag(read), flag(starred))
    private fun flag(e: JsonElement?): Boolean {
      val p = e as? JsonPrimitive ?: return false
      return p.booleanOrNull ?: (p.doubleOrNull?.let { it != 0.0 } ?: false)
    }
  }

  @Serializable data class ArticlePage(val items: List<ServerArticle> = emptyList(), val next: String? = null)
  @Serializable data class Counts(val unread: Map<String, Int> = emptyMap(), val starred: Int = 0)
  @Serializable data class AddedFeed(val feed: Feed, val created: Boolean)
  @Serializable data class Imported(val added: Int = 0, val existing: Int = 0, val categories: Int = 0)

  /** What the event stream reports: the sync cursor moved, or new articles arrived. */
  sealed interface Event {
    data class Cursor(val value: String) : Event
    data object Articles : Event
  }

  @Serializable data class Auth(val token: String, val user: User)

  @Serializable private data class Prelogin(val salt: String, val kdf: KdfParams)
  @Serializable private data class Challenge(val challenge: String, val bits: Int)
  @Serializable private data class Me(val user: User)
  @Serializable private data class Shared(val url: String)
  @Serializable private data class SettingsBox(val settings: SyncedSettings)
  @Serializable private data class CategoryBox(val category: Category)
  @Serializable private data class ArticleBox(val article: ServerArticle)
  @Serializable private data class FullTextBox(val fullText: FullTextDto)
  @Serializable private data class FullTextDto(val html: String, val title: String? = null, val byline: String? = null)
  @Serializable private data class NotesBox(val notes: List<Note> = emptyList())
  @Serializable private data class NoteBox(val note: Note)
  @Serializable private data class DevicesBox(val devices: List<Device> = emptyList())
  @Serializable private data class InvitesBox(val invites: List<Invite> = emptyList())
  @Serializable private data class InviteCode(val code: String)
  @Serializable private data class Problem(val error: String = "", val message: String? = null)

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

  companion object {
    private val http = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).build()
    /** The event stream stays open; the server writes every 25 s. */
    private val streaming = http.newBuilder().callTimeout(0, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS).build()

    /** "perch.example.com" → "https://perch.example.com"; null when it isn't an address. */
    fun normalizeServer(input: String): String? {
      var s = input.trim().trimEnd('/')
      if (s.isEmpty()) return null
      if (!s.contains("://")) s = "https://$s"
      val uri = runCatching { java.net.URI(s) }.getOrNull() ?: return null
      if (uri.scheme != "https" && uri.scheme != "http" || uri.host.isNullOrEmpty()) return null
      return "${uri.scheme}://${uri.rawAuthority}"
    }
  }

  suspend fun serverInfo(): ServerInfo = json.decodeFromString(call("server"))

  /** Prelogin, Argon2id, then login. */
  suspend fun login(username: String, password: String, deviceName: String): Auth {
    val keys = derive(username, password)
    return json.decodeFromString(
      call("auth/login", body = buildJsonObject { put("username", username); put("authKey", keys); put("deviceName", deviceName) }),
    )
  }

  /** [powBits] (from ServerInfo.pow) does the proof of work first; [recoveryCode] is stored hashed. */
  suspend fun register(
    username: String,
    password: String,
    powBits: Int?,
    recoveryCode: String?,
    deviceName: String,
    invite: String? = null,
    email: String? = null,
    emailCode: String? = null,
  ): Auth {
    val salt = KeyDerivation.newSalt()
    val kdf = KdfParams.DEFAULT
    val authKey = withContext(Dispatchers.Default) { KeyDerivation.derive(password, salt, kdf).authKey }
    var pow: JsonObject? = null
    if (powBits != null && powBits > 0) {
      val c = json.decodeFromString<Challenge>(call("auth/challenge"))
      val nonce = withContext(Dispatchers.Default) {
        val ctx = coroutineContext
        ProofOfWork.solve(c.challenge, c.bits) { runCatching { ctx.ensureActive() }.isFailure }
      }
      pow = buildJsonObject { put("challenge", c.challenge); put("nonce", nonce) }
    }
    val body = buildJsonObject {
      put("username", username)
      put("authKey", authKey)
      put("salt", salt)
      put("kdf", json.encodeToJsonElement(KdfParams.serializer(), kdf))
      pow?.let { put("pow", it) }
      recoveryCode?.let { put("recoveryCode", it) }
      invite?.takeIf { it.isNotBlank() }?.let { put("invite", it.trim()) }
      email?.let { put("email", it) }
      emailCode?.let { put("emailCode", it) }
      put("deviceName", deviceName)
    }
    return json.decodeFromString(call("auth/register", body = body))
  }

  /** A new password with the recovery code. Every other device is signed out. */
  suspend fun recover(username: String, recoveryCode: String, password: String, deviceName: String): Auth {
    val salt = KeyDerivation.newSalt()
    val authKey = withContext(Dispatchers.Default) { KeyDerivation.derive(password, salt, KdfParams.DEFAULT).authKey }
    val body = buildJsonObject {
      put("username", username)
      put("recoveryCode", recoveryCode)
      put("authKey", authKey)
      put("salt", salt)
      put("kdf", json.encodeToJsonElement(KdfParams.serializer(), KdfParams.DEFAULT))
      put("deviceName", deviceName)
    }
    return json.decodeFromString(call("auth/recover", body = body))
  }

  /** Replaces the recovery code, once the password confirms it. */
  suspend fun setRecoveryCode(username: String, password: String, code: String): User {
    val keys = derive(username, password)
    return json.decodeFromString<Me>(call("auth/recovery", body = buildJsonObject { put("authKey", keys); put("recoveryCode", code) })).user
  }

  /** A 6-digit code by email: [purpose] "signup", "reset" or "change". */
  suspend fun requestEmailCode(email: String, purpose: String, lang: String?) {
    call("auth/email/code", body = buildJsonObject { put("email", email); put("purpose", purpose); lang?.let { put("lang", it) } })
  }

  /** A new password with an emailed code. Every other device is signed out. */
  suspend fun resetPassword(email: String, code: String, password: String, deviceName: String): Auth {
    val salt = KeyDerivation.newSalt()
    val authKey = withContext(Dispatchers.Default) { KeyDerivation.derive(password, salt, KdfParams.DEFAULT).authKey }
    val body = buildJsonObject {
      put("email", email)
      put("code", code)
      put("authKey", authKey)
      put("salt", salt)
      put("kdf", json.encodeToJsonElement(KdfParams.serializer(), KdfParams.DEFAULT))
      put("deviceName", deviceName)
    }
    return json.decodeFromString(call("auth/reset", body = body))
  }

  suspend fun changeEmail(email: String, code: String): User =
    json.decodeFromString<Me>(call("auth/email", body = buildJsonObject { put("email", email); put("code", code) })).user

  suspend fun removeEmail(): User = json.decodeFromString<Me>(call("auth/email", "DELETE")).user

  suspend fun me(): User = json.decodeFromString<Me>(call("auth/me")).user

  suspend fun devices(): List<Device> = json.decodeFromString<DevicesBox>(call("devices")).devices

  suspend fun revokeDevice(id: String) {
    call("devices/${seg(id)}", "DELETE")
  }

  suspend fun invites(): List<Invite> = json.decodeFromString<InvitesBox>(call("admin/invites")).invites

  suspend fun createInvite(): String = json.decodeFromString<InviteCode>(call("admin/invites", body = JsonObject(emptyMap()))).code

  suspend fun deleteInvite(code: String) {
    call("admin/invites/${seg(code)}", "DELETE")
  }

  // Reader (a library on the server)

  suspend fun library(): Library = json.decodeFromString(call("reader/library"))
  suspend fun counts(): Counts = json.decodeFromString(call("reader/counts"))

  suspend fun articles(
    feed: String?, category: String?, unreadOnly: Boolean, starred: Boolean, search: String, before: String?, limit: Int,
  ): ArticlePage {
    val q = buildList {
      add("limit=$limit")
      feed?.let { add("feed=${seg(it)}") }
      category?.let { add("category=${seg(it)}") }
      if (unreadOnly) add("unread=1")
      if (starred) add("starred=1")
      if (search.isNotBlank()) add("q=${seg(search.trim())}")
      before?.let { add("before=${seg(it)}") }
    }.joinToString("&")
    return json.decodeFromString(call("reader/articles?$q"))
  }

  suspend fun article(feedId: String, id: String): Article =
    json.decodeFromString<ArticleBox>(call("reader/articles/${seg(feedId)}/${seg(id)}")).article.toArticle()

  suspend fun fullText(feedId: String, id: String, force: Boolean): FullText {
    val t = json.decodeFromString<FullTextBox>(call("reader/articles/${seg(feedId)}/${seg(id)}/fulltext" + if (force) "?force=1" else "")).fullText
    return FullText(t.html, t.title, t.byline)
  }

  /** [items] are (feedId, articleId) pairs. */
  suspend fun setState(items: List<Pair<String, String>>, read: Boolean?, starred: Boolean?) {
    val body = buildJsonObject {
      put("items", JsonArray(items.map { (f, a) -> buildJsonObject { put("feedId", f); put("id", a) } }))
      read?.let { put("read", it) }
      starred?.let { put("starred", it) }
    }
    call("reader/articles/state", body = body)
  }

  suspend fun markAllRead(feed: String?, category: String?, upTo: Double) {
    call("reader/articles/read-all", body = buildJsonObject { feed?.let { put("feed", it) }; category?.let { put("category", it) }; put("upTo", upTo) })
  }

  suspend fun refresh(feeds: Collection<String>?) {
    call("reader/refresh", body = buildJsonObject { feeds?.let { put("feeds", JsonArray(it.map(::JsonPrimitive))) } })
  }

  suspend fun addFeed(url: String, categoryId: String?): AddedFeed =
    json.decodeFromString(call("reader/feeds", body = buildJsonObject { put("url", url); categoryId?.let { put("categoryId", it) } }))

  suspend fun removeFeed(id: String) {
    call("reader/feeds/${seg(id)}", "DELETE")
  }

  /** "" for [customTitle] clears it. */
  suspend fun updateFeed(id: String, categoryId: String?, customTitle: String?) {
    call("reader/feeds/${seg(id)}", "PATCH", buildJsonObject { categoryId?.let { put("categoryId", it) }; customTitle?.let { put("customTitle", it) } })
  }

  suspend fun addCategory(name: String): Category =
    json.decodeFromString<CategoryBox>(call("reader/categories", body = buildJsonObject { put("name", name) })).category

  suspend fun updateCategory(id: String, name: String? = null, collapsed: Boolean? = null) {
    call("reader/categories/${seg(id)}", "PATCH", buildJsonObject { name?.let { put("name", it) }; collapsed?.let { put("collapsed", it) } })
  }

  suspend fun deleteCategory(id: String) {
    call("reader/categories/${seg(id)}", "DELETE")
  }

  suspend fun settings(): SyncedSettings = json.decodeFromString<SettingsBox>(call("reader/settings")).settings

  /** The keys that are set replace the stored ones. */
  suspend fun saveSettings(settings: SyncedSettings): SyncedSettings {
    val body = json.encodeToJsonElement(SyncedSettings.serializer(), settings) as JsonObject
    return json.decodeFromString<SettingsBox>(call("reader/settings", "PUT", body)).settings
  }

  suspend fun exportOpml(): String = call("reader/opml")

  suspend fun importOpml(data: ByteArray): Imported = json.decodeFromString(call("reader/opml", raw = data to "text/x-opml"))

  // Notes in a library on the server

  suspend fun notes(): List<Note> = json.decodeFromString<NotesBox>(call("notes")).notes

  suspend fun saveNote(id: String, title: String, url: String?, feedTitle: String?, body: String): Note {
    val b = buildJsonObject { put("title", title); url?.let { put("url", it) }; feedTitle?.let { put("feedTitle", it) }; put("body", body) }
    return json.decodeFromString<NoteBox>(call("notes/${seg(id)}", "PUT", b)).note
  }

  suspend fun deleteNote(id: String) {
    call("notes/${seg(id)}", "DELETE")
  }

  /** Shares a note the server already has (a library there); the server records the link on it. */
  suspend fun shareStoredNote(id: String): String =
    json.decodeFromString<Shared>(call("shares/${seg(id)}", "PUT", JsonObject(emptyMap()))).url

  /**
   * The server-sent event stream, until the connection drops (callers
   * reconnect). Each Perch event carries one data line.
   */
  fun events(): kotlinx.coroutines.flow.Flow<Event> = kotlinx.coroutines.flow.flow {
    val request = Request.Builder()
      .url("$server/api/v1/sync/events")
      .header("Accept", "text/event-stream")
      .apply { token?.let { header("Authorization", "Bearer $it") } }
      .build()
    val response = try {
      streaming.newCall(request).execute()
    } catch (e: IOException) {
      throw ApiError(0, "network", e.message ?: "Couldn't reach the server")
    }
    response.use {
      if (!it.isSuccessful) throw ApiError(it.code, "http-${it.code}", "Event stream refused")
      val source = it.body.source()
      var name = "message"
      while (true) {
        val line = source.readUtf8Line() ?: break
        when {
          line.isEmpty() -> name = "message"
          line.startsWith("event:") -> name = line.removePrefix("event:").trim()
          line.startsWith("data:") -> {
            val value = line.removePrefix("data:").trim()
            when (name) {
              "cursor" -> emit(Event.Cursor(value))
              "articles" -> emit(Event.Articles)
            }
            name = "message"
          }
        }
      }
    }
  }.flowOn(Dispatchers.IO)

  suspend fun logout() {
    call("auth/logout", body = JsonObject(emptyMap()))
  }

  /** Deletes the account and everything the server keeps with it, once the password confirms it. */
  suspend fun deleteAccount(username: String, password: String) {
    call("auth/delete", body = buildJsonObject { put("authKey", derive(username, password)) })
  }

  suspend fun changePassword(username: String, current: String, new: String) {
    val old = derive(username, current)
    val salt = KeyDerivation.newSalt()
    val next = withContext(Dispatchers.Default) { KeyDerivation.derive(new, salt, KdfParams.DEFAULT).authKey }
    call(
      "auth/password",
      body = buildJsonObject {
        put("authKey", old)
        put("newAuthKey", next)
        put("salt", salt)
        put("kdf", json.encodeToJsonElement(KdfParams.serializer(), KdfParams.DEFAULT))
      },
    )
  }

  /** Publishes a note as a public page made from [note]; returns its address. */
  suspend fun shareNote(note: Note): String {
    val body = buildJsonObject {
      put("title", note.title)
      note.url?.let { put("url", it) }
      note.feedTitle?.let { put("feedTitle", it) }
      put("body", note.body)
    }
    return json.decodeFromString<Shared>(call("shares/${seg(note.id)}", "PUT", body)).url
  }

  suspend fun unshareNote(id: String) {
    call("shares/${seg(id)}", "DELETE")
  }

  private suspend fun derive(username: String, password: String): String {
    val pre = json.decodeFromString<Prelogin>(call("auth/prelogin", body = buildJsonObject { put("username", username) }))
    return withContext(Dispatchers.Default) { KeyDerivation.derive(password, pre.salt, pre.kdf).authKey }
  }

  private fun seg(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

  private suspend fun call(
    path: String,
    method: String? = null,
    body: JsonObject? = null,
    raw: Pair<ByteArray, String>? = null,
  ): String = withContext(Dispatchers.IO) {
    val m = method ?: if (body != null || raw != null) "POST" else "GET"
    val content = raw?.let { (bytes, type) -> bytes.toRequestBody(type.toMediaType()) }
      ?: body?.let { json.encodeToString(JsonObject.serializer(), it).toRequestBody("application/json".toMediaType()) }
      ?: if (m == "GET" || m == "DELETE") null else "{}".toRequestBody("application/json".toMediaType())
    val request = Request.Builder()
      .url("$server/api/v1/$path")
      .header("Accept", "application/json")
      .apply { token?.let { header("Authorization", "Bearer $it") } }
      .method(m, content)
      .build()
    val response = try {
      http.newCall(request).execute()
    } catch (e: IOException) {
      throw ApiError(0, "network", e.message ?: "Couldn't reach the server")
    } catch (e: IllegalArgumentException) {
      throw ApiError(0, "bad-address", "That isn't a server address")
    }
    response.use {
      val text = it.body.string()
      if (!it.isSuccessful) {
        val p = runCatching { json.decodeFromString<Problem>(text) }.getOrNull()
        throw ApiError(it.code, p?.error?.ifEmpty { null } ?: "http-${it.code}", p?.message ?: p?.error ?: "The server answered ${it.code}")
      }
      text
    }
  }
}
