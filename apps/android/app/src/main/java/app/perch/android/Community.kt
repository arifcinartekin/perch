package app.perch.android

import app.perch.android.data.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** A Perch account: a name on a Perch Server you or a friend runs, for sharing notes. */
@Serializable
data class CommunityAccount(val server: String, val username: String, val token: String)

/**
 * The Perch account on this phone. It's separate from sync: the library can
 * sync by chain or not at all and still share through this account. The
 * session token is kept encrypted (SecureStore).
 */
class Community(private val secure: SecureStore) {
  private val _account = MutableStateFlow(
    secure.get("community")?.let { runCatching { Json.decodeFromString<CommunityAccount>(it) }.getOrNull() },
  )
  val account: StateFlow<CommunityAccount?> = _account.asStateFlow()

  fun save(account: CommunityAccount?) {
    secure.set("community", account?.let { Json.encodeToString(CommunityAccount.serializer(), it) })
    _account.value = account
  }

  fun client(): ApiClient? = _account.value?.let { ApiClient(it.server, it.token) }
}
