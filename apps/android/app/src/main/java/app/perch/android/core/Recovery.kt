package app.perch.android.core

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Recovery codes, as in @perch/core/recovery: 20 characters of Crockford
 * base32 (100 bits) in groups of four. Made on the device at sign-up and
 * shown once; the server keeps only a hash.
 */
object RecoveryCode {
  private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  const val LENGTH = 20

  fun new(): String {
    val bytes = ByteArray(LENGTH).also { SecureRandom().nextBytes(it) }
    // 256 is a multiple of 32, so each byte mod 32 is unbiased.
    return bytes.map { ALPHABET[(it.toInt() and 0xff) % 32] }.joinToString("").chunked(4).joinToString("-")
  }

  /** What someone typed, in canonical form; null when it can't be a code. */
  fun normalize(input: String): String? {
    val s = input.uppercase().filter { !it.isWhitespace() && it != '-' }.map {
      when (it) {
        'O' -> '0'
        'I', 'L' -> '1'
        else -> it
      }
    }.joinToString("")
    return s.takeIf { it.length == LENGTH && it.all { c -> c in ALPHABET } }
  }
}

/**
 * The sign-up proof of work, as in @perch/core/pow: a nonce whose
 * SHA-256(challenge + ":" + nonce) starts with `bits` zero bits.
 */
object ProofOfWork {
  fun leadingZeroBits(hash: ByteArray): Int {
    var bits = 0
    for (b in hash) {
      val v = b.toInt() and 0xff
      if (v == 0) {
        bits += 8
        continue
      }
      return bits + Integer.numberOfLeadingZeros(v) - 24
    }
    return bits
  }

  /** Blocks until solved; [cancelled] is checked now and then. */
  fun solve(challenge: String, bits: Int, cancelled: () -> Boolean = { false }): String {
    val digest = MessageDigest.getInstance("SHA-256")
    var n = 0L
    while (true) {
      if (n % 50_000 == 0L && cancelled()) throw InterruptedException()
      val nonce = n.toString(36)
      if (leadingZeroBits(digest.digest("$challenge:$nonce".toByteArray())) >= bits) return nonce
      n++
    }
  }
}

/**
 * Suggested usernames, as in @perch/core/username: two plain words and a
 * number, so nobody has to put their own name on a public profile.
 */
object UsernameSuggestion {
  private val adjectives = listOf(
    "quiet", "amber", "misty", "calm", "brisk", "gentle", "golden", "hidden", "lucky", "mellow",
    "nimble", "patient", "rustic", "silver", "sleepy", "steady", "sunny", "tidy", "wild", "windy",
    "bright", "cosy", "curious", "dusky", "early", "fuzzy", "hazel", "humble", "jolly", "little",
    "lofty", "merry", "olive", "plucky", "rapid", "shy", "snowy", "swift", "velvet", "wandering",
  )
  private val nouns = listOf(
    "heron", "finch", "wren", "robin", "owl", "sparrow", "swallow", "lark", "kestrel", "puffin",
    "otter", "badger", "fox", "hare", "lynx", "marten", "beaver", "seal", "moth", "beetle",
    "birch", "cedar", "fern", "maple", "willow", "pine", "reed", "moss", "brook", "cove",
    "dune", "glade", "harbor", "meadow", "pebble", "ridge", "tide", "valley", "reader", "page",
  )

  fun make(): String = "${adjectives.random()}_${nouns.random()}${(10..99).random()}"
}
