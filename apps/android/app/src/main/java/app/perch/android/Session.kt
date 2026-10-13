package app.perch.android

import android.content.Context
import app.perch.android.core.Opml
import app.perch.android.data.ApiClient
import app.perch.android.data.ArticleStore
import app.perch.android.data.LocalBackend
import app.perch.android.data.ServerBackend
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The account a library on a Perch Server belongs to (personal mode). */
@Serializable
data class LibraryAccount(val server: String, val username: String, val token: String)

/**
 * Where the library lives: on this phone, or on a Perch Server you sign in to
 * (Session in the iPhone app). Signing in adds the phone's feeds to the
 * account; signing out deletes the account's offline copy and goes back to
 * the phone's own library, which stays as it was. The token is kept
 * encrypted (SecureStore).
 */
class Session(private val context: Context, private val secure: SecureStore) {
  private val _account = MutableStateFlow(
    secure.get("library")?.let { runCatching { Json.decodeFromString<LibraryAccount>(it) }.getOrNull() },
  )
  val account: StateFlow<LibraryAccount?> = _account.asStateFlow()

  /** The offline copy of [account]'s library: its own database and cache file. */
  fun serverBackend(account: LibraryAccount): ServerBackend {
    val key = key(account)
    return ServerBackend(
      ApiClient(account.server, account.token),
      ArticleStore(context, "server-$key.db"),
      File(context.filesDir, "accounts/$key/library.json"),
    )
  }

  /**
   * Signed in or registered: the phone's feeds are subscribed on the server
   * too, so nothing is lost, and the library moves there.
   */
  suspend fun adopt(account: LibraryAccount, local: LocalBackend) {
    val library = local.library()
    if (library.feeds.isNotEmpty()) {
      runCatching { ApiClient(account.server, account.token).importOpml(Opml.build(library).toByteArray()) }
    }
    save(account)
  }

  /** Back to the phone's library; [erase] deletes the account's offline copy. */
  fun signOut(erase: Boolean = true) {
    val account = _account.value ?: return
    save(null)
    if (erase) {
      val key = key(account)
      context.deleteDatabase("server-$key.db")
      File(context.filesDir, "accounts/$key").deleteRecursively()
    }
  }

  private fun save(account: LibraryAccount?) {
    secure.set("library", account?.let { Json.encodeToString(LibraryAccount.serializer(), it) })
    _account.value = account
  }

  /** accounts/<hash of server and username>, as on the iPhone. */
  private fun key(account: LibraryAccount): String =
    MessageDigest.getInstance("SHA-256").digest("${account.server}|${account.username}".toByteArray())
      .take(12).joinToString("") { "%02x".format(it) }
}
