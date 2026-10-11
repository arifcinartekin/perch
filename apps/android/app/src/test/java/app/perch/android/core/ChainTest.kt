package app.perch.android.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared vectors from packages/core/tests/chain.test.ts (also pinned in the iPhone app). */
class ChainTest {
  private val secret = ByteArray(16) { it.toByte() }
  private val vectorCode = "000G-40R4-0M30-E209-185G-R38E-1X0G"
  private val vectorToken = "Y7Wa6yDxEtxEAWukDZMuf1kN_qolwFQsyKiC0HFs4yc"
  private val vectorSlot = "Oa4CSVR2mEEhKd_BDVYZIg"
  private val tsSealed = ChainRecord(
    key = "U4YedoXC32m-kxquAb7kPw", hlc = "1700000000000-0000-dev",
    blob = "AAAAAAAAAAAAAAAAYN2WqZ-YeQEmyPspk5ypEYB_wPPazHR7zD85Frue6sX_1tx6Sm5aBKUglkS7EoZ12nv9pEHyBWOggu34aEjDNetU_QF_oCpPFG1zctf-QYbUP0zndg4WgCbTL3W44zKOIw",
    version = 1,
  )

  @Test fun codeKeysAndSlotsMatchTypeScript() {
    assertEquals(vectorCode, ChainCode.format(secret))
    val keys = ChainKeys(secret)
    assertEquals(vectorToken, keys.token)
    assertEquals(vectorSlot, keys.slot("feed", "abc123"))
  }

  @Test fun parsingForgivesTypingAndRejectsTypos() {
    repeat(50) {
      val s = ChainCode.newSecret()
      assertArrayEquals(s, ChainCode.parse(ChainCode.format(s)))
    }
    val typed = vectorCode.lowercase().replace("-", " ").replace("0", "o").replace("1", "l")
    assertArrayEquals(secret, ChainCode.parse(typed))
    val chars = vectorCode.replace("-", "").toCharArray()
    chars[5] = if (chars[5] == 'A') 'B' else 'A'
    assertNull(ChainCode.parse(String(chars)))
    assertNull(ChainCode.parse("not a code at all, sorry!!"))
  }

  @Test fun links() {
    val link = ChainCode.link("https://sync.example.com", vectorCode)
    assertEquals("https://sync.example.com" to vectorCode, ChainCode.parseLink(link))
    assertEquals(ChainCode.DEFAULT_SERVER to vectorCode, ChainCode.parseLink("perch://chain?server=https%3A%2F%2Fsync.perch.ws&code=$vectorCode"))
    assertNull(ChainCode.parseLink("perch://chain?code=nope"))
  }

  @Test fun opensWhatTypeScriptSealed() {
    val r = ChainKeys(secret).open(tsSealed)!!
    assertEquals("category", r.type)
    assertEquals("c1", r.id)
    assertEquals(1, r.version)
    assertEquals("""{"collapsed":false,"name":"Tech","order":10}""", Canonical.of(r.data!!))
  }

  @Test fun sealsTheSharedVector() {
    val data = JsonObject(
      mapOf(
        "url" to JsonPrimitive("https://blog.example/feed.xml"),
        "categoryId" to JsonPrimitive("uncategorized"),
        "addedAt" to JsonPrimitive(1_700_000_000_000.0),
      ),
    )
    val sealed = ChainKeys(secret).seal(ChainSyncRecord("feed", "abc123", data, "1700000000001-0000-phone"), ByteArray(12) { 1 })
    assertEquals(vectorSlot, sealed.key)
    assertEquals(
      "AQEBAQEBAQEBAQEBPaHL4o_tfYn1ebpF8jOaB5YioDRDvrgJN7GHEprFa_tleg_mTSkhmyjYrxnHTScX4TLyC-G-cZzvBWVlzGDel6Ex5JIAStHvCBZuXQVCA-FN7P756Ob3RJCjC-nwWeuwsrkBBADJZqBpxgmKiSs1-Wl_xxXvevQJXkSLttMZ7piijWe-Bonv2s9mSntSLOegDw",
      sealed.blob,
    )
  }

  @Test fun refusesTamperingAndMarksReadStateEphemeral() {
    val keys = ChainKeys(secret)
    assertNull(ChainKeys(ChainCode.newSecret()).open(tsSealed))
    assertNull(keys.open(tsSealed.copy(key = vectorSlot)))
    assertNull(keys.open(tsSealed.copy(hlc = "1800000000000-0000-dev")))
    assertNull(keys.open(tsSealed.copy(deleted = true)))
    fun state(read: Boolean, starred: Boolean) = keys.seal(
      ChainSyncRecord("state", "f:a", JsonObject(mapOf("read" to JsonPrimitive(read), "starred" to JsonPrimitive(starred))), "1700000000000-0000-a"),
    ).ephemeral
    assertTrue(state(true, false))
    assertFalse(state(true, true))
    val gone = keys.seal(ChainSyncRecord("feed", "f1", null, "1700000000000-0001-a", deleted = true))
    assertTrue(keys.open(gone)!!.deleted)
  }

  @Test fun clockOrders() {
    val a = HybridClock("a")
    val first = a.now()
    val second = a.now()
    assertTrue(second > first)
    a.receive("9999999999999-0000-b")
    assertTrue(a.now() > "9999999999999-0000-b")
  }
}
