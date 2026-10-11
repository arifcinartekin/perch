package app.perch.android.core

import java.security.SecureRandom
import java.text.Normalizer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.Serializable
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters

@Serializable
data class KdfParams(
  val algorithm: String = "argon2id",
  /** Memory in KiB. */
  val memory: Int,
  val iterations: Int,
  val parallelism: Int,
) {
  /** The bounds a server accepts (KDF_LIMITS); anything else is refused before running. */
  val isValid: Boolean
    get() = algorithm == "argon2id" && memory in 8 * 1024..1024 * 1024 && iterations in 1..10 && parallelism in 1..4

  companion object {
    /** DEFAULT_KDF in packages/core/src/auth.ts. */
    val DEFAULT = KdfParams(memory = 64 * 1024, iterations = 3, parallelism = 1)
  }
}

class DerivedKeys(
  /** Sent in place of the password (base64url, 32 bytes). */
  val authKey: String,
  /** Never leaves the device. */
  val masterKey: ByteArray,
)

/**
 * Client-side password stretching, byte for byte deriveKeys() in
 * packages/core/src/auth.ts: Argon2id over the NFKC password with the
 * account's salt, then HKDF-SHA256 (empty salt) into an auth key, which is
 * all the server ever sees, and a master key reserved for the E2E vault.
 */
object KeyDerivation {
  class Unsupported : Exception("The server asked for key-derivation settings Perch doesn't accept.")
  class BadSalt : Exception("The server sent an invalid salt.")

  /** Runs Argon2id (about a second at the default 64 MiB); call it off the main thread. */
  fun derive(password: String, salt: String, params: KdfParams): DerivedKeys {
    if (!params.isValid) throw Unsupported()
    val saltBytes = ChainKeys.unb64(salt)?.takeIf { it.size >= 8 } ?: throw BadSalt()
    val pwd = Normalizer.normalize(password, Normalizer.Form.NFKC).toByteArray()
    val generator = Argon2BytesGenerator()
    generator.init(
      Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
        .withVersion(Argon2Parameters.ARGON2_VERSION_13)
        .withMemoryAsKB(params.memory)
        .withIterations(params.iterations)
        .withParallelism(params.parallelism)
        .withSalt(saltBytes)
        .build(),
    )
    val stretched = ByteArray(32)
    generator.generateBytes(pwd, stretched)
    return DerivedKeys(ChainKeys.b64(hkdf(stretched, "perch/auth/v1")), hkdf(stretched, "perch/master/v1"))
  }

  /** HKDF-SHA256 with an empty salt (a block of zeros, as RFC 5869 says), 32 bytes out. */
  private fun hkdf(ikm: ByteArray, info: String): ByteArray {
    fun hmac(key: ByteArray, data: ByteArray) =
      Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)
    val prk = hmac(ByteArray(32), ikm)
    return hmac(prk, info.toByteArray() + byteArrayOf(1))
  }

  /** A fresh 16-byte salt for a new account (newSalt() in core). */
  fun newSalt(): String = ChainKeys.b64(ByteArray(16).also { SecureRandom().nextBytes(it) })
}
