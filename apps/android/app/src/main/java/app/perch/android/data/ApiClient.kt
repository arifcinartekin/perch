package app.perch.android.data

import app.perch.android.core.KdfParams
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
import kotlinx.serialization.json.JsonObject
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
 * The Perch Server API (/api/v1) for a Perch account: sign-in, sign-up with
 * proof of work and a recovery code, and sharing notes. The password never
 * leaves the phone; only the key derived from it does (KeyDerivation).
 */
class ApiClient(val server: String, private val token: String? = null) {
  @Serializable
  data class ServerInfo(
    val software: String = "",
    val version: String = "",
    val mode: String = "personal",
    val signup: String = "closed",
    val chain: Boolean? = null,
    val pow: Int? = null,
    val recovery: Boolean? = null,
    val accountUrl: String? = null,
    val legal: Legal? = null,
  )

  @Serializable data class Legal(val privacy: String? = null, val terms: String? = null)

  @Serializable
  data class User(val id: String, val username: String, val role: String = "user", val hasRecovery: Boolean? = null)

  @Serializable data class Auth(val token: String, val user: User)

  @Serializable private data class Prelogin(val salt: String, val kdf: KdfParams)
  @Serializable private data class Challenge(val challenge: String, val bits: Int)
  @Serializable private data class Me(val user: User)
  @Serializable private data class Shared(val url: String)
  @Serializable private data class Problem(val error: String = "", val message: String? = null)

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

  companion object {
    private val http = OkHttpClient.Builder().callTimeout(60, TimeUnit.SECONDS).build()

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
  suspend fun register(username: String, password: String, powBits: Int?, recoveryCode: String?, deviceName: String): Auth {
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

  suspend fun me(): User = json.decodeFromString<Me>(call("auth/me")).user

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

  private suspend fun call(path: String, method: String? = null, body: JsonObject? = null): String = withContext(Dispatchers.IO) {
    val m = method ?: if (body != null) "POST" else "GET"
    val request = Request.Builder()
      .url("$server/api/v1/$path")
      .header("Accept", "application/json")
      .apply { token?.let { header("Authorization", "Bearer $it") } }
      .method(m, body?.let { json.encodeToString(JsonObject.serializer(), it).toRequestBody("application/json".toMediaType()) })
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
