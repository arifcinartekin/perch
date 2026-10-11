package app.perch.android.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Well-known feeds by topic, offered on an empty library and in Explore. The
 * list is packages/core/src/starter-packs.ts, shipped as assets/starter-packs.json
 * (`npm run starter-packs` writes it).
 */
@Serializable
data class StarterPack(
  val id: String,
  val lang: String,
  val title: Map<String, String>,
  val description: Map<String, String>,
  val feeds: List<StarterFeed>,
) {
  fun title(tr: Boolean) = title[if (tr) "tr" else "en"] ?: title["en"].orEmpty()
  fun description(tr: Boolean) = description[if (tr) "tr" else "en"] ?: description["en"].orEmpty()
}

@Serializable
data class StarterFeed(val title: String, val url: String, val lang: String)

object StarterPacks {
  private val json = Json { ignoreUnknownKeys = true }

  fun parse(text: String): List<StarterPack> = json.decodeFromString(text)

  /** The viewer's language first (starterPacksFor in core). */
  fun forLanguage(packs: List<StarterPack>, language: String): List<StarterPack> {
    val mine = if (language.lowercase().startsWith("tr")) "tr" else "en"
    return packs.sortedByDescending { it.lang == mine }
  }
}
