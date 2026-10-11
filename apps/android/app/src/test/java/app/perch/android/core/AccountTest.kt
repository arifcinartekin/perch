package app.perch.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Vectors from deriveKeys() in packages/core/src/auth.ts, also pinned in the iPhone app. */
class AccountTest {
  private val salt = "AAECAwQFBgcICQoLDA0ODw"

  @Test fun keysMatchTheWebClientAtTheDefaultCost() {
    val keys = KeyDerivation.derive("correct horse battery staple", salt, KdfParams.DEFAULT)
    assertEquals("FDraHTNhtuHuOHYUTGyFX5brj8BAd-twiMlacL5TQ_I", keys.authKey)
    assertEquals("hQ8a08dIrJrZOCiIkojGzluIyICxwlJ3WqAawHXOV58", ChainKeys.b64(keys.masterKey))
  }

  @Test fun normalisesThePasswordAndHonoursParallelism() {
    val keys = KeyDerivation.derive("ﬁancé Ⅻ", salt, KdfParams(memory = 8192, iterations = 2, parallelism = 2))
    assertEquals("vbqIpdmATSpme47QMatSTTavq_6CdMU9y28nxmKMeLY", keys.authKey)
    assertEquals("BWZcwa_Si385wdNWMyvVHI0MPH82DNgCtl_GSvCjdu0", ChainKeys.b64(keys.masterKey))
  }

  @Test(expected = KeyDerivation.Unsupported::class)
  fun refusesParametersOutsideTheServerLimits() {
    KeyDerivation.derive("x", salt, KdfParams(memory = 1024, iterations = 1, parallelism = 1))
  }

  @Test fun recoveryCodes() {
    val code = RecoveryCode.new()
    assertEquals(24, code.length)
    assertEquals(code.replace("-", ""), RecoveryCode.normalize(code.lowercase()))
    assertNull(RecoveryCode.normalize("too short"))
  }

  @Test fun proofOfWork() {
    assertEquals(12, ProofOfWork.leadingZeroBits(byteArrayOf(0, 0x0f, 0x7f)))
    val nonce = ProofOfWork.solve("abc", 10)
    val hash = java.security.MessageDigest.getInstance("SHA-256").digest("abc:$nonce".toByteArray())
    assertTrue(ProofOfWork.leadingZeroBits(hash) >= 10)
    assertTrue(Regex("[a-z]+_[a-z]+\\d\\d").matches(UsernameSuggestion.make()))
  }
}
