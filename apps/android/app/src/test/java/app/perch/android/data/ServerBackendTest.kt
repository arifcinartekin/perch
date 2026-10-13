package app.perch.android.data

import app.perch.android.core.Article
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerBackendTest {
  /** The server decodes this with decodeCursor in apps/server/src/reader/routes.ts. */
  @Test fun cursorsAreTheServersOwn() {
    val a = Article("a1", "f1", null, "T", null, 1_767_225_600_000.0, null, null, emptyList())
    // Buffer.from(JSON.stringify([1767225600000, "f1", "a1"])).toString("base64url")
    assertEquals("WzE3NjcyMjU2MDAwMDAsImYxIiwiYTEiXQ", articleCursor(a))
  }
}
