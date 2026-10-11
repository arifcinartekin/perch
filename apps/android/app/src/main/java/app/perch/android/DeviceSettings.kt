package app.perch.android

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Settings that stay on this phone and never sync: list pictures and background refresh. */
class DeviceSettings(context: Context) {
  private val prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)

  private val _listImages = MutableStateFlow(prefs.getBoolean("listImages", true))
  val listImages: StateFlow<Boolean> = _listImages.asStateFlow()

  /** Minutes between background refreshes; 0 = off. */
  private val _refreshMinutes = MutableStateFlow(prefs.getInt("refreshMinutes", 60))
  val refreshMinutes: StateFlow<Int> = _refreshMinutes.asStateFlow()

  fun setListImages(on: Boolean) {
    prefs.edit().putBoolean("listImages", on).apply()
    _listImages.value = on
  }

  fun setRefreshMinutes(minutes: Int) {
    prefs.edit().putInt("refreshMinutes", minutes).apply()
    _refreshMinutes.value = minutes
  }
}
