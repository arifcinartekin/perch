package app.perch.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * Settings that stay on this phone and never sync: list pictures, background
 * refresh, notifications, the article text size and the wallpaper (the image
 * itself is a file).
 */
class DeviceSettings(private val context: Context) {
  private val prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)

  private val _listImages = MutableStateFlow(prefs.getBoolean("listImages", true))
  val listImages: StateFlow<Boolean> = _listImages.asStateFlow()

  /** Minutes between background refreshes; 0 = off. */
  private val _refreshMinutes = MutableStateFlow(prefs.getInt("refreshMinutes", 60))
  val refreshMinutes: StateFlow<Int> = _refreshMinutes.asStateFlow()

  /** A notification when background refresh finds new articles. */
  private val _notifyNew = MutableStateFlow(prefs.getBoolean("notifyNew", false))
  val notifyNew: StateFlow<Boolean> = _notifyNew.asStateFlow()

  /** Article text, in sp, and its line height as a multiple of it. */
  private val _textSize = MutableStateFlow(prefs.getFloat("textSize", DEFAULT_TEXT_SIZE))
  val textSize: StateFlow<Float> = _textSize.asStateFlow()
  private val _lineHeight = MutableStateFlow(prefs.getFloat("lineHeight", DEFAULT_LINE_HEIGHT))
  val lineHeight: StateFlow<Float> = _lineHeight.asStateFlow()

  /** Background-colour overlay on the wallpaper, 0–0.9, and its blur in dp. */
  private val _wallpaperDim = MutableStateFlow(prefs.getFloat("wallpaperDim", 0.35f))
  val wallpaperDim: StateFlow<Float> = _wallpaperDim.asStateFlow()
  private val _wallpaperBlur = MutableStateFlow(prefs.getFloat("wallpaperBlur", 0f))
  val wallpaperBlur: StateFlow<Float> = _wallpaperBlur.asStateFlow()
  private val _wallpaper = MutableStateFlow<Bitmap?>(null)
  val wallpaper: StateFlow<Bitmap?> = _wallpaper.asStateFlow()

  private val wallpaperFile get() = File(context.filesDir, "wallpaper.jpg")

  init {
    if (wallpaperFile.exists()) _wallpaper.value = BitmapFactory.decodeFile(wallpaperFile.path)
  }

  fun setListImages(on: Boolean) {
    prefs.edit().putBoolean("listImages", on).apply()
    _listImages.value = on
  }

  fun setRefreshMinutes(minutes: Int) {
    prefs.edit().putInt("refreshMinutes", minutes).apply()
    _refreshMinutes.value = minutes
  }

  fun setNotifyNew(on: Boolean) {
    prefs.edit().putBoolean("notifyNew", on).apply()
    _notifyNew.value = on
  }

  fun setTextSize(size: Float) {
    val s = size.coerceIn(TEXT_SIZES.start, TEXT_SIZES.endInclusive)
    prefs.edit().putFloat("textSize", s).apply()
    _textSize.value = s
  }

  fun setLineHeight(multiple: Float) {
    prefs.edit().putFloat("lineHeight", multiple).apply()
    _lineHeight.value = multiple
  }

  fun setWallpaperDim(dim: Float) {
    prefs.edit().putFloat("wallpaperDim", dim).apply()
    _wallpaperDim.value = dim
  }

  fun setWallpaperBlur(blur: Float) {
    prefs.edit().putFloat("wallpaperBlur", blur).apply()
    _wallpaperBlur.value = blur
  }

  /** Stores a picked photo, scaled down so it stays light in memory. False if it can't be read. */
  suspend fun setWallpaper(uri: Uri): Boolean = withContext(Dispatchers.IO) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) return@withContext false
    var sample = 1
    while (longest / (sample * 2) >= MAX_WALLPAPER) sample *= 2
    val decoded = context.contentResolver.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: return@withContext false
    val scale = minOf(1f, MAX_WALLPAPER.toFloat() / maxOf(decoded.width, decoded.height))
    val bitmap = if (scale < 1f) {
      Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true)
    } else decoded
    val tmp = File(context.filesDir, "wallpaper.jpg.tmp")
    tmp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
    tmp.renameTo(wallpaperFile)
    _wallpaper.value = bitmap
    true
  }

  fun removeWallpaper() {
    wallpaperFile.delete()
    _wallpaper.value = null
  }

  companion object {
    const val DEFAULT_TEXT_SIZE = 18f
    const val DEFAULT_LINE_HEIGHT = 1.6f
    val TEXT_SIZES = 14f..26f
    /** Tight, normal and loose, as on the iPhone. */
    val LINE_HEIGHTS = listOf(1.4f, 1.6f, 1.85f)
    private const val MAX_WALLPAPER = 2400
  }
}
