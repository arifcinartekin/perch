package app.perch.android.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.perch.android.perch
import app.perch.android.widget.Headlines
import java.util.concurrent.TimeUnit

/**
 * Fetches every feed now and then while the app is closed, on any network,
 * then updates the widget and notifies about new articles.
 */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val reader = applicationContext.perch.reader
    return runCatching {
      reader.chain.prepare()
      reader.refresh()
      Headlines.update(applicationContext, notify = true)
    }.fold({ Result.success() }, { Result.retry() })
  }

  companion object {
    private const val NAME = "refresh"

    /** [minutes] between runs; 0 turns it off. Android runs it at most every 15 minutes. */
    fun schedule(context: Context, minutes: Int) {
      val work = WorkManager.getInstance(context)
      if (minutes <= 0) {
        work.cancelUniqueWork(NAME)
        return
      }
      val request = PeriodicWorkRequestBuilder<RefreshWorker>(maxOf(15, minutes).toLong(), TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
      work.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }
  }
}
