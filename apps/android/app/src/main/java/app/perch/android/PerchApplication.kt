package app.perch.android

import android.app.Application
import android.content.Context
import app.perch.android.data.ArticleStore
import app.perch.android.data.ChainSync
import app.perch.android.data.LocalBackend
import app.perch.android.work.RefreshWorker
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class PerchApplication : Application() {
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  val device by lazy { DeviceSettings(this) }
  val secure by lazy { SecureStore(this) }
  val lock by lazy { AppLock(this, secure) }
  val session by lazy { Session(this, secure) }
  /** The phone's own library, and the chain it syncs in; kept while a server holds the library. */
  val local by lazy { LocalBackend(ArticleStore(this), File(filesDir, "library.json")) }
  val chain by lazy { ChainLink(secure, ChainSync(local, File(filesDir, "chain.json"))) { ChainLink.phoneName(this) } }
  val community by lazy { Community(secure) }

  private val _reader by lazy { MutableStateFlow(makeReader()) }
  /** The Reader for where the library is now; a new one when that changes. */
  val readers: StateFlow<Reader> get() = _reader.asStateFlow()
  val reader: Reader get() = _reader.value

  private fun makeReader(): Reader {
    val account = session.account.value
    val backend = account?.let { session.serverBackend(it).also { b -> b.onUnauthorized = { sessionExpired() } } } ?: local
    return Reader(this, backend, scope, device, chain, community)
  }

  /** Signed in to a Perch Server: the phone's feeds join the account and the library moves there. */
  suspend fun useServer(account: LibraryAccount) {
    session.adopt(account, local)
    switch {}
  }

  /** Back to the phone's own library; the account's offline copy is deleted. */
  fun useLocal() = switch { session.signOut() }

  private fun switch(change: () -> Unit) {
    _reader.value.close()
    change()
    _reader.value = makeReader().also { it.start() }
    app.perch.android.widget.Headlines.forget(this)
  }

  /** The server turned the token down (signed out elsewhere, account deleted). */
  private fun sessionExpired() {
    scope.launch { if (session.account.value != null) useLocal() }
  }

  override fun onCreate() {
    super.onCreate()
    RefreshWorker.schedule(this, device.refreshMinutes.value)
  }
}

val Context.perch: PerchApplication get() = applicationContext as PerchApplication
