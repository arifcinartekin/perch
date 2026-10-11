package app.perch.android

import android.os.Build
import app.perch.android.core.ChainCode
import app.perch.android.core.ChainKeys
import app.perch.android.data.ChainClient
import app.perch.android.data.ChainError
import app.perch.android.data.ChainSync
import java.security.SecureRandom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

/** The chain this phone is in: its relay, its code, and this device's clock id. */
@Serializable
data class ChainAccount(val server: String, val code: String, val node: String)

/**
 * Sync without an account: the library on this phone, kept in step with the
 * other devices in a chain through a relay that only sees encrypted records.
 * Starting, joining and leaving, and the rounds themselves (the merging is
 * ChainSync's).
 */
class ChainLink(private val secure: SecureStore, private val sync: ChainSync, private val deviceName: () -> String) {
  sealed interface Problem {
    /** Another device deleted the chain. */
    data object Ended : Problem
    data object Unreachable : Problem
    data class Other(val message: String) : Problem
  }

  private val _account = MutableStateFlow(load())
  val account: StateFlow<ChainAccount?> = _account.asStateFlow()
  private val _syncing = MutableStateFlow(false)
  val syncing: StateFlow<Boolean> = _syncing.asStateFlow()
  private val _lastSyncAt = MutableStateFlow(sync.state().lastSyncAt)
  val lastSyncAt: StateFlow<Double?> = _lastSyncAt.asStateFlow()
  private val _problem = MutableStateFlow<Problem?>(null)
  val problem: StateFlow<Problem?> = _problem.asStateFlow()
  private val _devices = MutableStateFlow(sync.state().devices)
  val devices: StateFlow<Map<String, ChainSync.Device>> = _devices.asStateFlow()

  private fun load(): ChainAccount? =
    secure.get("chain")?.let { runCatching { Json.decodeFromString<ChainAccount>(it) }.getOrNull() }

  /** Picks up where the last launch left off. */
  suspend fun prepare() = sync.setEnabled(_account.value != null, reset = false)

  companion object {
    /** The phone's own name (Settings → About phone), else its maker and model. */
    fun phoneName(context: android.content.Context): String =
      android.provider.Settings.Global.getString(context.contentResolver, android.provider.Settings.Global.DEVICE_NAME)
        ?.takeIf { it.isNotBlank() }
        ?: listOf(Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, Build.MODEL).distinct().joinToString(" ").ifBlank { "Android" }

    /** A random clock id for this device, like the extension's. */
    private fun newNode(): String {
      val bytes = ByteArray(6).also { SecureRandom().nextBytes(it) }
      return bytes.joinToString("") { "%02x".format(it) }
    }

    private val http = OkHttpClient()

    /** Whether the server at this address relays chains (GET /api/v1/server). */
    fun isRelay(server: String): Boolean {
      val request = Request.Builder().url(server.trimEnd('/') + "/api/v1/server").build()
      return try {
        http.newCall(request).execute().use { r ->
          if (!r.isSuccessful) return false
          Json.parseToJsonElement(r.body.string()).let { (it as? kotlinx.serialization.json.JsonObject)?.get("chain")?.toString() == "true" }
        }
      } catch (e: Exception) {
        android.util.Log.w("Perch", "Relay check failed for $server", e)
        throw ChainError.Network()
      }
    }

    fun normalizeServer(input: String): String? {
      var s = input.trim().trimEnd('/')
      if (s.isEmpty()) return null
      if (!s.contains("://")) s = "https://$s"
      return s.takeIf { it.startsWith("https://") || it.startsWith("http://") }
    }
  }

  /** Starts a chain on [server] with this phone's library in it. */
  suspend fun start(server: String) = withContext(Dispatchers.IO) {
    if (!isRelay(server)) throw ChainError.NotARelay()
    val code = ChainCode.format(ChainCode.newSecret())
    ChainClient(server, ChainKeys.fromCode(code)!!).create()
    adopt(ChainAccount(server, code, newNode()))
  }

  /** Joins the chain with this code; its library and this phone's merge. */
  suspend fun join(server: String, typed: String) = withContext(Dispatchers.IO) {
    val code = ChainCode.normalize(typed) ?: throw IllegalArgumentException("bad-code")
    val keys = ChainKeys.fromCode(code)!!
    if (!isRelay(server)) throw ChainError.NotARelay()
    ChainClient(server, keys).changes(0, 1)
    adopt(ChainAccount(server, code, newNode()))
  }

  private suspend fun adopt(account: ChainAccount) {
    sync.setEnabled(enabled = true, reset = true)
    secure.set("chain", Json.encodeToString(ChainAccount.serializer(), account))
    _account.value = account
    _problem.value = null
    _lastSyncAt.value = null
    _devices.value = emptyMap()
  }

  /** Stops syncing here. The library stays on the phone. */
  suspend fun leave() {
    _account.value?.let { a ->
      ChainKeys.fromCode(a.code)?.let { keys -> sync.announceLeaving(keys, ChainClient(a.server, keys), a.node) }
    }
    secure.set("chain", null)
    _account.value = null
    _problem.value = null
    _lastSyncAt.value = null
    _devices.value = emptyMap()
    sync.setEnabled(enabled = false, reset = true)
  }

  /** Removes the chain from the relay, for every device in it. */
  suspend fun delete() {
    val a = _account.value ?: return
    val keys = ChainKeys.fromCode(a.code) ?: return
    withContext(Dispatchers.IO) {
      try {
        ChainClient(a.server, keys).delete()
      } catch (e: ChainError.NotFound) {
        // Already gone.
      }
    }
    leave()
  }

  suspend fun forget(id: String) {
    sync.forgetDevice(id)
    _devices.value = _devices.value - id
  }

  /** One round. Null when not in a chain or it failed (see [problem]). */
  suspend fun sync(): ChainSync.Result? {
    val a = _account.value ?: return null
    val keys = ChainKeys.fromCode(a.code) ?: return null
    if (_problem.value == Problem.Ended) return null
    _syncing.value = true
    try {
      val result = sync.sync(keys, ChainClient(a.server, keys), a.node, ChainSync.Device(deviceName(), "android"))
      _lastSyncAt.value = System.currentTimeMillis().toDouble()
      _devices.value = sync.state().devices
      _problem.value = null
      return result
    } catch (e: ChainError.NotFound) {
      android.util.Log.w("Perch", "Chain round failed", e)
      _problem.value = Problem.Ended
    } catch (e: ChainError.Network) {
      android.util.Log.w("Perch", "Chain round failed", e)
      _problem.value = Problem.Unreachable
    } catch (e: Exception) {
      android.util.Log.w("Perch", "Chain round failed", e)
      _problem.value = Problem.Other(e.message ?: e.toString())
    } finally {
      _syncing.value = false
    }
    return null
  }
}
