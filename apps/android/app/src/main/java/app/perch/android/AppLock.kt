package app.perch.android

import android.content.Context
import android.os.SystemClock
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The app lock: a 6-digit PIN, kept as a salted PBKDF2 hash in SecureStore,
 * and optionally the phone's fingerprint or face to open it. A convenience
 * lock, like the extension's and the iPhone's: the library on disk isn't
 * encrypted with it.
 */
class AppLock(context: Context, private val secure: SecureStore) {
  private val prefs = context.getSharedPreferences("device", Context.MODE_PRIVATE)

  private val _enabled = MutableStateFlow(secure.get("pin") != null)
  val enabled: StateFlow<Boolean> = _enabled.asStateFlow()
  private val _biometric = MutableStateFlow(prefs.getBoolean("lockBiometric", true))
  val biometric: StateFlow<Boolean> = _biometric.asStateFlow()
  private val _locked = MutableStateFlow(_enabled.value)
  val locked: StateFlow<Boolean> = _locked.asStateFlow()

  private var leftAt = 0L

  companion object {
    /** Back within this long, the app stays open. */
    private const val GRACE_MS = 60_000L

    fun isValid(pin: String) = pin.length == 6 && pin.all { it.isDigit() }

    private fun hash(pin: String, salt: ByteArray): ByteArray =
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pin.toCharArray(), salt, 120_000, 256)).encoded
  }

  fun setPin(pin: String) {
    require(isValid(pin))
    val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
    secure.set("pin", android.util.Base64.encodeToString(salt + hash(pin, salt), android.util.Base64.NO_WRAP))
    _enabled.value = true
  }

  fun clear() {
    secure.set("pin", null)
    _enabled.value = false
    _locked.value = false
  }

  fun setBiometric(on: Boolean) {
    prefs.edit().putBoolean("lockBiometric", on).apply()
    _biometric.value = on
  }

  /** True and unlocked when [pin] is right. */
  fun unlock(pin: String): Boolean {
    val stored = secure.get("pin")?.let { android.util.Base64.decode(it, android.util.Base64.NO_WRAP) } ?: return true.also { _locked.value = false }
    val ok = MessageDigest.isEqual(hash(pin, stored.copyOf(16)), stored.copyOfRange(16, stored.size))
    if (ok) _locked.value = false
    return ok
  }

  /** The fingerprint or face matched. */
  fun unlockedByBiometric() {
    _locked.value = false
  }

  fun wentToBackground() {
    leftAt = SystemClock.elapsedRealtime()
  }

  fun cameToForeground() {
    if (_enabled.value && leftAt > 0 && SystemClock.elapsedRealtime() - leftAt > GRACE_MS) _locked.value = true
  }
}
