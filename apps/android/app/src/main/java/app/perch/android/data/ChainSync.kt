package app.perch.android.data

import app.perch.android.core.Category
import app.perch.android.core.Canonical
import app.perch.android.core.ChainKeys
import app.perch.android.core.ChainSyncRecord
import app.perch.android.core.Feed
import app.perch.android.core.HybridClock
import app.perch.android.core.Note
import app.perch.android.core.SyncedSettings
import app.perch.android.core.UNCATEGORIZED_ID
import app.perch.android.core.bool
import app.perch.android.core.num
import app.perch.android.core.str
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement

/**
 * Syncing the library on this phone through a chain: the Android side of
 * apps/extension/src/lib/sync/engine.ts (and the iPhone app's
 * LocalBackend+Chain.swift), with the same rules.
 *
 * One round pulls what changed on the relay and merges it, then pushes what
 * changed here. Change detection is a "shadow": for every record, the
 * canonical value last agreed with the chain. Local value ≠ shadow means it
 * was changed here and still has to go out, and an incoming record for that
 * key is skipped, because the push that follows carries a newer clock and
 * wins anyway. Read and star changes wait in the store's pending table.
 */
class ChainSync(private val backend: LocalBackend, private val file: File) {
  /** Bookkeeping for the chain, kept next to the library. None of it syncs. */
  @Serializable
  data class State(
    /** Highest relay version applied here. */
    val cursor: Int = 0,
    /** Last clock value, so ours keeps moving forward across launches. */
    val hlc: String? = null,
    /** "type:id" → canonical value last agreed with the chain. */
    val shadow: Map<String, String> = emptyMap(),
    /** Read and starred for articles this phone hasn't fetched yet. */
    val parked: Map<String, ArticleState> = emptyMap(),
    val lastSyncAt: Double? = null,
    val lastError: String? = null,
    /** The chain's devices as each describes itself, by clock node. */
    val devices: Map<String, Device> = emptyMap(),
    /** Devices forgotten here, to remove from the chain on the next round. */
    val forgotten: List<String> = emptyList(),
  )

  @Serializable data class ArticleState(val read: Boolean, val starred: Boolean)

  /** A device in the chain, as in DeviceRecordData (packages/core/src/sync.ts). */
  @Serializable
  data class Device(val name: String, val platform: String, val seenAt: Double = System.currentTimeMillis().toDouble())

  data class Result(val pulled: Int, val pushed: Int, val newFeedIds: List<String>)

  companion object {
    private const val PUSH_BATCH = 500
    /** How often a device refreshes its record (DEVICE_REFRESH_MS). */
    const val DEVICE_REFRESH_MS = 12 * 60 * 60 * 1000.0
  }

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
  private val running = Mutex()
  private val stateLock = Mutex()

  init {
    backend.afterArticles = { applyParked() }
  }

  fun state(): State = runCatching { json.decodeFromString<State>(file.readText()) }.getOrDefault(State())

  private fun save(st: State) {
    val tmp = File(file.parentFile, file.name + ".tmp")
    tmp.writeText(json.encodeToString(State.serializer(), st))
    tmp.renameTo(file)
  }

  /** Turns queueing on or off. [reset] starts the bookkeeping over, for joining or leaving a chain. */
  suspend fun setEnabled(enabled: Boolean, reset: Boolean) = withContext(Dispatchers.IO) {
    backend.chainOn = enabled
    if (reset) {
      stateLock.withLock { save(State()) }
      backend.store.clearAllPending()
    }
  }

  /** Runs a round; a call while one is running waits for it and runs after. */
  suspend fun sync(keys: ChainKeys, client: ChainClient, node: String, device: Device?): Result =
    running.withLock { withContext(Dispatchers.IO) { round(keys, client, node, device) } }

  private suspend fun round(keys: ChainKeys, client: ChainClient, node: String, device: Device?): Result {
    var st = state()
    val clock = HybridClock(node)
    st.hlc?.let(clock::receive)
    try {
      var pulled = 0
      val added = mutableListOf<String>()
      st = pull(st, clock, client, keys) { n, ids -> pulled += n; added += ids }
      val (afterPush, pushed) = push(st, clock, client, keys, node, device)
      st = afterPush
      if (pushed > 0) st = pull(st, clock, client, keys) { n, ids -> pulled += n; added += ids }
      st = st.copy(hlc = clock.now(), lastSyncAt = System.currentTimeMillis().toDouble(), lastError = null)
      save(st)
      return Result(pulled, pushed, added)
    } catch (e: Exception) {
      save(st.copy(hlc = clock.now(), lastError = e.message ?: e.toString()))
      throw e
    }
  }

  // Pull

  private suspend fun pull(
    start: State,
    clock: HybridClock,
    client: ChainClient,
    keys: ChainKeys,
    report: (Int, List<String>) -> Unit,
  ): State {
    var st = start
    while (true) {
      val page = client.changes(st.cursor)
      page.records.forEach { clock.receive(it.hlc) }
      val records = page.records.mapNotNull(keys::open)
      if (records.isNotEmpty()) {
        val (next, added) = applyRemote(records, st)
        st = next
        report(records.count { !it.hlc.endsWith("-${clock.node}") }, added)
      }
      st = st.copy(cursor = page.cursor)
      save(st)
      if (!page.more) return st
    }
  }

  /** Merges records from the chain. Returns the new state and the ids of feeds it added. */
  private suspend fun applyRemote(records: List<ChainSyncRecord>, start: State): Pair<State, List<String>> {
    val store = backend.store
    val pendingIds = store.pending().map { it.id }.toSet()
    var shadow = start.shadow
    var parked = start.parked
    var devices = start.devices
    val added = mutableListOf<String>()
    val removed = mutableListOf<String>()
    val states = mutableListOf<Pair<String, ArticleState>>()

    fun editedHere(key: String, local: String?): Boolean {
      val s = shadow[key] ?: return false
      return s != local
    }

    backend.update { saved ->
      var feeds = saved.library.feeds
      var categories = saved.library.categories
      var settings = saved.settings
      var notes = saved.notes
      var validators = saved.validators
      for (r in records) {
        when (r.type) {
          "feed" -> {
            val existing = feeds.firstOrNull { it.id == r.id }
            if (editedHere(r.key, existing?.let(::feedCanon))) continue
            if (r.deleted) {
              if (existing != null) {
                feeds = feeds - existing
                validators = validators - r.id
                removed += r.id
              }
              shadow = shadow - r.key
              continue
            }
            val d = r.data ?: continue
            val url = d.str("url") ?: continue
            val categoryId = d.str("categoryId") ?: UNCATEGORIZED_ID
            val customTitle = d.str("customTitle")?.ifEmpty { null }
            val addedAt = d.num("addedAt") ?: System.currentTimeMillis().toDouble()
            feeds = if (existing != null) {
              feeds.map { if (it.id == r.id) it.copy(categoryId = categoryId, customTitle = customTitle, addedAt = addedAt) else it }
            } else {
              added += r.id
              feeds + Feed(
                id = r.id, url = url, title = d.str("title") ?: (runCatching { java.net.URI(url).host }.getOrNull() ?: url),
                customTitle = customTitle, siteUrl = d.str("siteUrl"), categoryId = categoryId, addedAt = addedAt,
              )
            }
            shadow = shadow + (r.key to feedCanon(url, customTitle, categoryId, addedAt))
          }
          "category" -> {
            val existing = categories.firstOrNull { it.id == r.id }
            if (editedHere(r.key, existing?.let { categoryRecord(it).second })) continue
            if (r.deleted) {
              if (existing != null) categories = categories - existing
              shadow = shadow - r.key
              continue
            }
            val d = r.data ?: continue
            val name = d.str("name") ?: continue
            val category = Category(r.id, name, d.num("order") ?: 0.0, d.bool("collapsed") ?: false)
            categories = if (existing != null) categories.map { if (it.id == r.id) category else it } else categories + category
            shadow = shadow + (r.key to categoryRecord(category).second)
          }
          "setting" -> {
            val field = SettingField.entries.firstOrNull { it.id == r.id } ?: continue
            if (editedHere(r.key, field.value(settings, json)?.let(Canonical::of))) continue
            val value = if (r.deleted) null else r.data?.get("value")
            // A value this version can't read is left alone, and not pushed back.
            val next = field.set(settings, value, json) ?: continue
            settings = next
            field.value(settings, json)?.let { shadow = shadow + (r.key to Canonical.of(it)) } ?: run { shadow = shadow - r.key }
          }
          "note" -> {
            if (editedHere(r.key, notes[r.id]?.let { noteRecord(it).second })) continue
            if (r.deleted) {
              notes = notes - r.id
              shadow = shadow - r.key
            } else {
              val note = runCatching { json.decodeFromJsonElement(Note.serializer(), r.data!!) }.getOrNull() ?: continue
              if (note.id != r.id) continue
              notes = notes + (r.id to note)
              shadow = shadow + (r.key to noteRecord(note).second)
            }
          }
          "device" -> {
            devices = if (r.deleted) devices - r.id else {
              val d = r.data ?: continue
              val name = d.str("name") ?: continue
              devices + (r.id to Device(name, d.str("platform").orEmpty(), d.num("seenAt") ?: 0.0))
            }
          }
          "state" -> {
            // A change here that hasn't gone out yet wins on push.
            if (r.id in pendingIds || r.deleted) continue
            val read = r.data?.bool("read") ?: continue
            val starred = r.data.bool("starred") ?: continue
            states += r.id to ArticleState(read, starred)
          }
        }
      }
      saved.copy(
        library = saved.library.copy(feeds = feeds, categories = categories),
        settings = settings, notes = notes, validators = validators,
      )
    }
    for (id in removed) store.deleteArticles(id, keepStarred = true)
    for ((id, value) in states) {
      if (store.article(id) != null) {
        store.setState(id, value.read, value.starred)
        parked = parked - id
      } else {
        parked = parked + (id to value)
      }
    }
    return start.copy(shadow = shadow, parked = parked, devices = devices) to added
  }

  /** Read and star changes from the chain for articles fetched since. */
  suspend fun applyParked() = withContext(Dispatchers.IO) {
    stateLock.withLock {
      val st = state()
      if (st.parked.isEmpty()) return@withLock
      var parked = st.parked
      for ((id, value) in st.parked) {
        if (backend.store.article(id) != null) {
          backend.store.setState(id, value.read, value.starred)
          parked = parked - id
        }
      }
      save(st.copy(parked = parked))
    }
  }

  /** Hides a device here and removes it from the chain on the next round. */
  suspend fun forgetDevice(id: String) = withContext(Dispatchers.IO) {
    val st = state()
    save(st.copy(devices = st.devices - id, forgotten = (st.forgotten + id).distinct()))
  }

  /** Takes this phone off the other devices' lists, on the way out of a chain. */
  suspend fun announceLeaving(keys: ChainKeys, client: ChainClient, node: String) = withContext(Dispatchers.IO) {
    val clock = HybridClock(node)
    state().hlc?.let(clock::receive)
    runCatching { client.push(listOf(keys.seal(ChainSyncRecord("device", node, null, clock.now(), deleted = true)))) }
  }

  // Push

  private suspend fun push(
    start: State,
    clock: HybridClock,
    client: ChainClient,
    keys: ChainKeys,
    node: String,
    device: Device?,
  ): Pair<State, Int> {
    val s = backend.load()
    var shadow = start.shadow
    val outgoing = mutableListOf<Pair<ChainSyncRecord, String?>>()

    // This phone keeps its own device record fresh, and removes the ones forgotten here.
    var announced: Device? = null
    if (device != null) {
      val known = start.devices[node]
      if (known == null || known.name != device.name || device.seenAt - known.seenAt > DEVICE_REFRESH_MS) {
        announced = device
        val data = JsonObject(mapOf("name" to JsonPrimitive(device.name), "platform" to JsonPrimitive(device.platform), "seenAt" to JsonPrimitive(device.seenAt)))
        outgoing += ChainSyncRecord("device", node, data, clock.now()) to null
      }
    }
    for (id in start.forgotten) outgoing += ChainSyncRecord("device", id, null, clock.now(), deleted = true) to null

    fun diff(type: String, local: Map<String, Pair<JsonObject, String>>) {
      for ((id, value) in local.toSortedMap()) {
        if (shadow["$type:$id"] != value.second) outgoing += ChainSyncRecord(type, id, value.first, clock.now()) to value.second
      }
      // In the shadow but gone here: deleted on this phone.
      for (key in shadow.keys.sorted()) {
        if (!key.startsWith("$type:")) continue
        val id = key.drop(type.length + 1)
        if (id !in local) outgoing += ChainSyncRecord(type, id, null, clock.now(), deleted = true) to null
      }
    }
    diff("feed", s.library.feeds.associate { it.id to feedRecord(it) })
    diff("category", s.library.categories.associate { it.id to categoryRecord(it) })
    diff("note", s.notes.mapValues { noteRecord(it.value) })
    // Settings this phone doesn't have (or doesn't know) aren't pushed.
    for (field in SettingField.entries) {
      val value = field.value(s.settings, json) ?: continue
      val canon = Canonical.of(value)
      if (shadow["setting:${field.id}"] != canon) {
        outgoing += ChainSyncRecord("setting", field.id, JsonObject(mapOf("value" to value)), clock.now()) to canon
      }
    }
    val pending = backend.store.pending()
    for (p in pending) {
      val article = backend.store.article(p.id)
      val read = article?.read ?: p.read ?: false
      val starred = article?.starred ?: p.starred ?: false
      outgoing += ChainSyncRecord("state", p.id, JsonObject(mapOf("read" to JsonPrimitive(read), "starred" to JsonPrimitive(starred))), clock.now()) to null
    }
    if (outgoing.isEmpty()) return start to 0

    var pushed = 0
    for (batch in outgoing.chunked(PUSH_BATCH)) {
      val res = client.push(batch.map { keys.seal(it.first) })
      // Every outcome settles the record: "ok" stored it, "stale" means a newer
      // write is on the relay (the pull that follows brings it in), "invalid"
      // would only fail again.
      res.results.forEachIndexed { i, _ ->
        if (i >= batch.size) return@forEachIndexed
        val (record, canon) = batch[i]
        pushed++
        if (record.type == "state" || record.type == "device") return@forEachIndexed
        shadow = if (record.deleted || canon == null) shadow - record.key else shadow + (record.key to canon)
      }
    }
    // Clear what went out, keeping anything that changed again meanwhile.
    backend.store.clearPending(pending)
    var devices = start.devices
    if (announced != null) devices = devices + (node to announced)
    return start.copy(shadow = shadow, devices = devices, forgotten = if (start.forgotten.isEmpty()) start.forgotten else emptyList()) to pushed
  }

  // Records

  private fun feedCanon(url: String, customTitle: String?, categoryId: String, addedAt: Double): String =
    Canonical.of(
      JsonObject(
        mapOf(
          "url" to JsonPrimitive(url), "customTitle" to (customTitle?.let(::JsonPrimitive) ?: JsonNull),
          "categoryId" to JsonPrimitive(categoryId), "addedAt" to JsonPrimitive(addedAt),
        ),
      ),
    )

  private fun feedCanon(f: Feed) = feedCanon(f.url, f.customTitle?.ifEmpty { null }, f.categoryId, f.addedAt)

  private fun feedRecord(f: Feed): Pair<JsonObject, String> {
    val d = buildMap<String, JsonElement> {
      put("url", JsonPrimitive(f.url))
      put("categoryId", JsonPrimitive(f.categoryId))
      put("addedAt", JsonPrimitive(f.addedAt))
      if (f.title.isNotEmpty()) put("title", JsonPrimitive(f.title))
      f.customTitle?.takeIf { it.isNotEmpty() }?.let { put("customTitle", JsonPrimitive(it)) }
      f.siteUrl?.let { put("siteUrl", JsonPrimitive(it)) }
    }
    return JsonObject(d) to feedCanon(f)
  }

  private fun categoryRecord(c: Category): Pair<JsonObject, String> {
    val data = JsonObject(mapOf("name" to JsonPrimitive(c.name), "order" to JsonPrimitive(c.order), "collapsed" to JsonPrimitive(c.collapsed ?: false)))
    return data to Canonical.of(data)
  }

  private fun noteRecord(n: Note): Pair<JsonObject, String> {
    val data = json.encodeToJsonElement(Note.serializer(), n) as JsonObject
    return data to Canonical.of(data)
  }

  /** The synced settings this app keeps (the extension has a few more, which it leaves alone). */
  private enum class SettingField(val id: String) {
    THEME("theme"), READING_FONT("readingFont"), APPEARANCE("appearance"), GLASS("glass");

    fun value(s: SyncedSettings, json: Json): JsonElement? = when (this) {
      THEME -> s.theme?.let(::JsonPrimitive)
      READING_FONT -> s.readingFont?.let(::JsonPrimitive)
      APPEARANCE -> s.appearance?.let { json.encodeToJsonElement(it) }
      GLASS -> s.glass?.let { json.encodeToJsonElement(it) }
    }

    /** The settings with this field set from the chain's value (null clears it), or null when it doesn't fit. */
    fun set(s: SyncedSettings, value: JsonElement?, json: Json): SyncedSettings? {
      if (value == null || value is JsonNull) {
        return when (this) {
          THEME -> s.copy(theme = null)
          READING_FONT -> s.copy(readingFont = null)
          APPEARANCE -> s.copy(appearance = null)
          GLASS -> s.copy(glass = null)
        }
      }
      return runCatching {
        when (this) {
          THEME -> s.copy(theme = (value as JsonPrimitive).content.takeIf { it in setOf("system", "light", "dark") }!!)
          READING_FONT -> s.copy(readingFont = (value as JsonPrimitive).content.takeIf { it in setOf("sans", "serif") }!!)
          APPEARANCE -> s.copy(appearance = json.decodeFromJsonElement(app.perch.android.core.Appearance.serializer(), value))
          GLASS -> s.copy(glass = json.decodeFromJsonElement(app.perch.android.core.GlassSettings.serializer(), value))
        }
      }.getOrNull()
    }
  }
}
