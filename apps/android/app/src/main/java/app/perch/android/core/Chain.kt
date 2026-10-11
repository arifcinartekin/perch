package app.perch.android.core

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

// Sync chains: sync without an account, through a relay that can't read what
// it passes on. A port of packages/core/src/chain.ts (via the iPhone app's
// Chain.swift); the code, keys and record format match it byte for byte, and
// ChainTest pins the shared vectors.

object ChainCode {
  /** The relay a new chain uses unless you pick another. */
  const val DEFAULT_SERVER = "https://sync.perch.ws"

  private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  private const val SECRET_BYTES = 16
  private const val LENGTH = 28

  fun newSecret(): ByteArray = ByteArray(SECRET_BYTES).also { SecureRandom().nextBytes(it) }

  /** CRC-8, polynomial 0x07. */
  private fun crc8(bytes: ByteArray): Int {
    var crc = 0
    for (b in bytes) {
      crc = crc xor (b.toInt() and 0xff)
      repeat(8) { crc = if (crc and 0x80 != 0) ((crc shl 1) xor 0x07) and 0xff else (crc shl 1) and 0xff }
    }
    return crc
  }

  /** "7GQ2-M4XD-…": seven groups of four, Crockford base 32. */
  fun format(secret: ByteArray): String {
    require(secret.size == SECRET_BYTES) { "A chain secret is 16 bytes" }
    val bytes = secret + crc8(secret).toByte()
    val out = StringBuilder()
    var value = 0
    var bits = 0
    for (b in bytes) {
      value = (value shl 8) or (b.toInt() and 0xff)
      bits += 8
      while (bits >= 5) {
        out.append(ALPHABET[(value shr (bits - 5)) and 31])
        bits -= 5
      }
      value = value and ((1 shl bits) - 1)
    }
    if (bits > 0) out.append(ALPHABET[(value shl (5 - bits)) and 31])
    return out.chunked(4).joinToString("-")
  }

  /** The secret in a code as typed (any case, dashes optional, O→0, I/L→1), or null. */
  fun parse(input: String): ByteArray? {
    val clean = StringBuilder()
    for (ch in input.uppercase()) {
      if (ch.isWhitespace() || ch == '-') continue
      clean.append(
        when (ch) {
          'O' -> '0'
          'I', 'L' -> '1'
          else -> ch
        },
      )
    }
    if (clean.length != LENGTH) return null
    val bytes = ArrayList<Byte>()
    var value = 0
    var bits = 0
    for (ch in clean) {
      val v = ALPHABET.indexOf(ch)
      if (v < 0) return null
      value = (value shl 5) or v
      bits += 5
      if (bits >= 8) {
        bytes.add(((value shr (bits - 8)) and 0xff).toByte())
        bits -= 8
      }
      value = value and ((1 shl bits) - 1)
    }
    if (value != 0 || bytes.size != SECRET_BYTES + 1) return null
    val secret = bytes.take(SECRET_BYTES).toByteArray()
    return if (crc8(secret).toByte() == bytes.last()) secret else null
  }

  fun normalize(input: String): String? = parse(input)?.let(::format)

  /** perch://chain?server=…&code=… — what the QR code holds. */
  fun link(server: String, code: String): String =
    "perch://chain?server=${URLEncoder.encode(server, "UTF-8")}&code=${URLEncoder.encode(code, "UTF-8")}"

  fun parseLink(text: String): Pair<String, String>? {
    val uri = runCatching { URI(text.trim()) }.getOrNull() ?: return null
    if (uri.scheme != "perch" || uri.host != "chain") return null
    val items = uri.rawQuery.orEmpty().split('&').mapNotNull {
      val i = it.indexOf('=')
      if (i < 0) null else it.take(i) to URLDecoder.decode(it.drop(i + 1), "UTF-8")
    }.toMap()
    val code = items["code"]?.let(::normalize) ?: return null
    val server = items["server"]
    if (server != null && !(server.startsWith("https://") || server.startsWith("http://"))) return null
    return (server ?: DEFAULT_SERVER) to code
  }
}

/** A sync record, as in packages/core/src/sync.ts. */
data class ChainSyncRecord(
  val type: String,
  val id: String,
  /** Null on tombstones. */
  val data: JsonObject?,
  val hlc: String,
  val deleted: Boolean = false,
  /** The relay's version; 0 for a record going out. */
  val version: Int = 0,
) {
  val key: String get() = "$type:$id"
}

/** A record as the relay stores it. */
@Serializable
data class ChainRecord(
  val key: String,
  val hlc: String,
  val deleted: Boolean = false,
  val ephemeral: Boolean = false,
  val blob: String,
  val version: Int = 0,
)

class ChainKeys(secret: ByteArray) {
  /** Bearer token for the relay (base64url, 32 bytes). */
  val token: String
  private val enc: ByteArray
  private val mac: ByteArray

  init {
    token = b64(derive(secret, "perch/chain/token/v1"))
    enc = derive(secret, "perch/chain/enc/v1")
    mac = derive(secret, "perch/chain/mac/v1")
  }

  companion object {
    private val SALT = "perch-chain-v1".toByteArray()
    val RECORD_TYPES = setOf("feed", "category", "setting", "state", "note", "device")

    fun fromCode(code: String): ChainKeys? = ChainCode.parse(code)?.let(::ChainKeys)

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
      Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }.doFinal(data)

    /** HKDF-SHA256 with one block of output (32 bytes). */
    private fun derive(secret: ByteArray, info: String): ByteArray {
      val prk = hmac(SALT, secret)
      return hmac(prk, info.toByteArray() + byteArrayOf(1))
    }

    fun b64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun unb64(s: String): ByteArray? = runCatching { Base64.getUrlDecoder().decode(s) }.getOrNull()
  }

  /** base64url of the first 16 bytes of HMAC(mac, "type:id"). */
  fun slot(type: String, id: String): String = b64(hmac(mac, "$type:$id".toByteArray()).copyOf(16))

  private fun additionalData(key: String, hlc: String, deleted: Boolean) =
    "$key\n$hlc\n${if (deleted) 1 else 0}".toByteArray()

  /** [iv] is for tests; normally random. */
  fun seal(record: ChainSyncRecord, iv: ByteArray? = null): ChainRecord {
    val key = slot(record.type, record.id)
    val body = buildMap<String, JsonElement> {
      put("type", JsonPrimitive(record.type))
      put("id", JsonPrimitive(record.id))
      if (!record.deleted && record.data != null) put("data", record.data)
    }
    val plain = Canonical.of(JsonObject(body)).toByteArray()
    val nonce = iv ?: ByteArray(12).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(enc, "AES"), GCMParameterSpec(128, nonce))
    cipher.updateAAD(additionalData(key, record.hlc, record.deleted))
    val sealed = nonce + cipher.doFinal(plain)
    val d = record.data
    val ephemeral = record.type == "state" && !record.deleted && d != null &&
      (d["read"] as? JsonPrimitive)?.booleanOrNull == true && (d["starred"] as? JsonPrimitive)?.booleanOrNull != true
    return ChainRecord(key, record.hlc, record.deleted, ephemeral, b64(sealed))
  }

  /** The record inside, or null when it doesn't decrypt or isn't in its slot. */
  fun open(stored: ChainRecord): ChainSyncRecord? {
    val bytes = unb64(stored.blob) ?: return null
    if (bytes.size <= 28) return null
    val plain = runCatching {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(enc, "AES"), GCMParameterSpec(128, bytes, 0, 12))
      cipher.updateAAD(additionalData(stored.key, stored.hlc, stored.deleted))
      cipher.doFinal(bytes, 12, bytes.size - 12)
    }.getOrNull() ?: return null
    val body = runCatching { Json.parseToJsonElement(plain.decodeToString()) as? JsonObject }.getOrNull() ?: return null
    val type = (body["type"] as? JsonPrimitive)?.contentOrNull ?: return null
    val id = (body["id"] as? JsonPrimitive)?.contentOrNull ?: return null
    if (type !in RECORD_TYPES || slot(type, id) != stored.key) return null
    val data = if (stored.deleted) null else (body["data"] as? JsonObject ?: return null)
    return ChainSyncRecord(type, id, data, stored.hlc, stored.deleted, stored.version)
  }
}

/** JSON with sorted keys and integral numbers written as integers, so equal values compare equal. */
object Canonical {
  fun of(e: JsonElement): String = when (e) {
    is JsonNull -> "null"
    is JsonObject -> e.entries.sortedBy { it.key }.joinToString(",", "{", "}") { (k, v) -> JsonPrimitive(k).toString() + ":" + of(v) }
    is JsonArray -> e.joinToString(",", "[", "]") { of(it) }
    is JsonPrimitive -> when {
      e.isString -> e.toString()
      e.booleanOrNull != null -> e.content
      else -> {
        val n = e.doubleOrNull
        if (n != null && n == Math.rint(n) && kotlin.math.abs(n) < 1e15) n.toLong().toString() else e.content
      }
    }
  }
}

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

/**
 * Hybrid logical clock, as in packages/core/src/sync.ts:
 * "<13-digit ms>-<4-char base-36 counter>-<node>", ordered as plain strings.
 */
class HybridClock(val node: String) {
  private var ms = 0L
  private var counter = 0

  companion object {
    private const val COUNTER_MAX = 36 * 36 * 36 * 36 - 1

    fun format(ms: Long, counter: Int, node: String) =
      ms.toString().padStart(13, '0') + "-" + counter.toString(36).padStart(4, '0') + "-" + node

    fun parse(hlc: String): Pair<Long, Int>? {
      val parts = hlc.split("-", limit = 3)
      if (parts.size != 3 || parts[0].length != 13 || parts[1].length != 4) return null
      val ms = parts[0].toLongOrNull() ?: return null
      val c = parts[1].toIntOrNull(36) ?: return null
      return ms to c
    }
  }

  private val wall: Long get() = System.currentTimeMillis()

  /** A timestamp for a change made here. */
  fun now(): String {
    val w = wall
    if (w > ms) {
      ms = w
      counter = 0
    } else {
      bump()
    }
    return format(ms, counter, node)
  }

  /** Folds in a timestamp seen from another device. */
  fun receive(remote: String) {
    val (rms, rc) = parse(remote) ?: return
    val top = maxOf(wall, ms, rms)
    when {
      top == ms && top == rms -> {
        counter = maxOf(counter, rc)
        bump()
      }
      top == ms -> bump()
      top == rms -> {
        ms = top
        counter = rc
        bump()
      }
      else -> {
        ms = top
        counter = 0
      }
    }
  }

  private fun bump() {
    if (counter >= COUNTER_MAX) {
      ms++
      counter = 0
    } else {
      counter++
    }
  }
}
