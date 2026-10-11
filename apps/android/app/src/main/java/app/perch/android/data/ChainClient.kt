package app.perch.android.data

import app.perch.android.core.ChainKeys
import app.perch.android.core.ChainRecord
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Errors from a chain relay. */
sealed class ChainError(message: String) : Exception(message) {
  /** The relay has no chain with this code (never started, or deleted). */
  class NotFound : ChainError("This chain isn't on the relay any more")
  /** The server doesn't relay chains. */
  class NotARelay : ChainError("That server doesn't relay sync chains")
  class Network : ChainError("Couldn't reach the relay")
  class Server(val status: Int, message: String) : ChainError(message)
}

/** /api/v1/chain on a Perch Server, for one chain. */
class ChainClient(val server: String, keys: ChainKeys, client: OkHttpClient? = null) {
  private val token = keys.token
  private val http = client ?: OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

  @Serializable data class Page(val records: List<ChainRecord>, val cursor: Int, val more: Boolean)
  @Serializable data class PushItem(val key: String, val status: String, val version: Int? = null)
  @Serializable data class PushResult(val results: List<PushItem>, val cursor: Int)
  @Serializable private data class Push(val records: List<ChainRecord>)
  @Serializable private data class Problem(val error: String, val message: String? = null)

  /** Creates the chain, or confirms it exists. Returns whether it was new. */
  fun create(): Boolean = call("", "POST", "{}").let {
    (json.parseToJsonElement(it) as JsonObject)["created"]?.jsonPrimitive?.boolean ?: false
  }

  fun changes(since: Int, limit: Int = 500): Page = json.decodeFromString(call("/changes?since=$since&limit=$limit"))

  fun push(records: List<ChainRecord>): PushResult =
    json.decodeFromString(call("/push", "POST", json.encodeToString(Push.serializer(), Push(records))))

  /** Removes the chain from the relay, for every device in it. */
  fun delete() {
    call("", "DELETE")
  }

  private fun call(path: String, method: String = "GET", body: String? = null): String {
    val request = Request.Builder()
      .url(server.trimEnd('/') + "/api/v1/chain" + path)
      .header("Authorization", "Bearer $token")
      .header("Cache-Control", "no-cache")
      .method(method, body?.toRequestBody("application/json".toMediaType()))
      .build()
    val response = try {
      http.newCall(request).execute()
    } catch (e: IOException) {
      throw ChainError.Network()
    } catch (e: IllegalArgumentException) {
      throw ChainError.Network()
    }
    response.use {
      val text = it.body.string()
      if (!it.isSuccessful) {
        val problem = runCatching { json.decodeFromString<Problem>(text) }.getOrNull()
        when (problem?.error) {
          "chain-not-found" -> throw ChainError.NotFound()
          "chain-off" -> throw ChainError.NotARelay()
        }
        if (it.code == 404) throw ChainError.NotARelay()
        throw ChainError.Server(it.code, problem?.message ?: "The server answered ${it.code}")
      }
      return text
    }
  }
}
