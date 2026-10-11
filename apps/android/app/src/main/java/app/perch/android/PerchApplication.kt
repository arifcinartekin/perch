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

class PerchApplication : Application() {
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  val device by lazy { DeviceSettings(this) }
  val secure by lazy { SecureStore(this) }
  val reader by lazy {
    val backend = LocalBackend(ArticleStore(this), File(filesDir, "library.json"))
    val chain = ChainLink(secure, ChainSync(backend, File(filesDir, "chain.json"))) { ChainLink.phoneName(this) }
    Reader(this, backend, scope, device, chain)
  }

  override fun onCreate() {
    super.onCreate()
    RefreshWorker.schedule(this, device.refreshMinutes.value)
  }
}

val Context.perch: PerchApplication get() = applicationContext as PerchApplication
