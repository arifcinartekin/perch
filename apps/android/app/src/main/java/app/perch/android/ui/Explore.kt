package app.perch.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.FeedIds
import app.perch.android.core.StarterPack
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.launch

/** Explore: the starter packs, any time (the compass in Feeds). */
@Composable
fun ExploreScreen(reader: Reader, nav: Nav) {
  val haze = rememberHazeState()
  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {
        LazyColumn(
          contentPadding = PaddingValues(
            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp,
            bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 24.dp,
          ),
          verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
          item { ListHeader(stringResource(R.string.explore), showLogo = false, subtitle = stringResource(R.string.explore_intro)) }
          items(reader.starterPacks, key = { it.id }) { pack -> StarterPackCard(reader, pack) }
        }
      }
      TopScrim()
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
      }
    }
  }
}

/**
 * One pack: add all of it into its own category, or single feeds; what you
 * already follow is marked.
 */
@Composable
fun StarterPackCard(reader: Reader, pack: StarterPack, modifier: Modifier = Modifier) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  val library by reader.library.collectAsState()
  val following = library.feeds.map { it.id }.toSet()
  val ids = pack.feeds.associate { it.url to FeedIds.feed(it.url) }
  val missing = pack.feeds.filter { ids[it.url] !in following }
  var busy by remember { mutableStateOf(false) }
  val adding = remember { mutableStateMapOf<String, Boolean>() }
  val title = pack.title(reader.turkish)

  Column(
    modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(24.dp))
      .background(look.solid.copy(alpha = look.surfaceOpacity(0.3))).padding(16.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(title, color = look.text, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        Text(pack.description(reader.turkish), color = look.muted, fontSize = 14.sp, lineHeight = 19.sp)
      }
      Spacer(Modifier.size(10.dp))
      if (missing.isEmpty()) {
        OutlinedButton(onClick = {}, enabled = false) {
          Icon(Icons.Rounded.Check, null, Modifier.size(16.dp))
          Text(" " + stringResource(R.string.added))
        }
      } else {
        Button(
          onClick = {
            busy = true
            scope.launch {
              runCatching { reader.addFeeds(missing.map { it.url }, title) }
              busy = false
            }
          },
          enabled = !busy,
          colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
        ) {
          if (busy) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = look.buttonContrast)
          } else {
            Text(
              if (missing.size == pack.feeds.size) stringResource(R.string.add_all)
              else stringResource(R.string.add_n_more, missing.size),
              fontWeight = FontWeight.SemiBold,
            )
          }
        }
      }
    }
    Spacer(Modifier.size(8.dp))
    for (feed in pack.feeds) {
      val followed = ids[feed.url] in following
      Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(feed.title, color = look.text, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        when {
          followed -> Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Check, stringResource(R.string.added), tint = look.accentText, modifier = Modifier.size(20.dp))
          }
          adding[feed.url] == true -> Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = look.accent)
          }
          else -> IconButton(onClick = {
            adding[feed.url] = true
            scope.launch {
              runCatching { reader.addFeeds(listOf(feed.url), title) }
              adding.remove(feed.url)
            }
          }) { Icon(Icons.Rounded.Add, stringResource(R.string.add), tint = look.accentText) }
        }
      }
    }
  }
}

/** What an empty library shows: a word on Perch, a way to add a feed, and the starter packs. */
@Composable
fun Welcome(reader: Reader, nav: Nav) {
  val look = LocalLook.current
  var adding by remember { mutableStateOf(false) }
  Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
      Text(stringResource(R.string.welcome), color = look.muted, fontSize = 16.sp, lineHeight = 22.sp)
      Spacer(Modifier.size(12.dp))
      Button(
        onClick = { adding = true },
        colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
      ) {
        Icon(Icons.Rounded.Add, null, Modifier.size(18.dp))
        Text(" " + stringResource(R.string.add_feed), fontWeight = FontWeight.SemiBold)
      }
      Spacer(Modifier.size(18.dp))
      Text(stringResource(R.string.starter_packs), color = look.text, fontSize = 20.sp, fontWeight = FontWeight.Bold)
      Text(stringResource(R.string.explore_intro), color = look.muted, fontSize = 14.sp, lineHeight = 19.sp)
    }
    for (pack in reader.starterPacks) StarterPackCard(reader, pack)
  }
  if (adding) AddFeedSheet(reader, onDismiss = { adding = false })
}
