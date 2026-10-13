package app.perch.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.DoneAll
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.FilterListOff
import androidx.compose.material.icons.rounded.MarkEmailRead
import androidx.compose.material.icons.rounded.MarkEmailUnread
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Article
import app.perch.android.data.ReaderBackend
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Which articles a list shows. */
sealed interface ListSpec {
  data object Unread : ListSpec
  data object Starred : ListSpec
  data object All : ListSpec
  data class Feed(val id: String) : ListSpec
  data class Category(val id: String) : ListSpec
}

/** Pages of a list's articles, newest first, updated in place as they're read and starred. */
private class ArticlePages(private val reader: Reader, private val spec: ListSpec) {
  val items = mutableStateListOf<Article>()
  var loading by mutableStateOf(false)
  var end by mutableStateOf(false)
  var loaded by mutableStateOf(false)

  suspend fun reload(unreadOnly: Boolean) {
    loading = true
    val page = load(unreadOnly, null)
    items.clear()
    items.addAll(page)
    end = page.size < PAGE
    loading = false
    loaded = true
  }

  suspend fun more(unreadOnly: Boolean) {
    if (loading || end) return
    loading = true
    val page = load(unreadOnly, items.lastOrNull())
    items.addAll(page.filter { a -> items.none { it.id == a.id } })
    end = page.size < PAGE
    loading = false
  }

  fun update(article: Article) {
    val i = items.indexOfFirst { it.id == article.id }
    if (i >= 0) items[i] = article
  }

  private suspend fun load(unreadOnly: Boolean, before: Article?): List<Article> = when (spec) {
    ListSpec.Unread -> reader.backend.articles(ReaderBackend.Scope.ALL, unreadOnly = true, before = before, limit = PAGE)
    ListSpec.Starred -> reader.backend.articles(ReaderBackend.Scope.STARRED, before = before, limit = PAGE)
    ListSpec.All -> reader.backend.articles(ReaderBackend.Scope.ALL, unreadOnly = unreadOnly, before = before, limit = PAGE)
    is ListSpec.Feed -> reader.backend.articles(ReaderBackend.Scope.ALL, feed = spec.id, unreadOnly = unreadOnly, before = before, limit = PAGE)
    is ListSpec.Category -> reader.backend.articles(ReaderBackend.Scope.ALL, category = spec.id, unreadOnly = unreadOnly, before = before, limit = PAGE)
  }

  companion object {
    const val PAGE = 50
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticleListScreen(reader: Reader, nav: Nav, spec: ListSpec, pushed: Boolean) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  val library by reader.library.collectAsState()
  val refreshing by reader.refreshing.collectAsState()
  val changed by reader.articlesChanged.collectAsState()
  val listImages by reader.device.listImages.collectAsState()
  val loadedLibrary by reader.loaded.collectAsState()
  val pages = remember(spec) { ArticlePages(reader, spec) }
  // A feed's or category's list can show everything; Unread and Starred are what they say.
  var unreadOnly by rememberSaveable(spec) { mutableStateOf(spec !is ListSpec.Starred && spec != ListSpec.All) }
  val listState = rememberLazyListState()
  val haze = if (pushed) rememberHazeState() else LocalHaze.current!!

  val title = when (spec) {
    ListSpec.Unread -> stringResource(R.string.tab_unread)
    ListSpec.Starred -> stringResource(R.string.tab_starred)
    ListSpec.All -> stringResource(R.string.all_articles)
    is ListSpec.Feed -> reader.feed(spec.id)?.displayTitle.orEmpty()
    is ListSpec.Category -> library.categories.firstOrNull { it.id == spec.id }?.name
      ?: stringResource(R.string.uncategorized)
  }
  val feedIdOf = { a: Article -> a.feedId }

  LaunchedEffect(spec, changed, unreadOnly) { pages.reload(if (spec == ListSpec.Unread) true else unreadOnly) }
  LaunchedEffect(pages) { reader.updates.collect { pages.update(it) } }
  LaunchedEffect(listState, pages) {
    snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
      .distinctUntilChanged()
      .collect { last -> if (last >= pages.items.size - 10) pages.more(unreadOnly) }
  }

  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {
        val pull = rememberPullToRefreshState()
        val topBar = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 60.dp
        PullToRefreshBox(
          isRefreshing = refreshing,
          state = pull,
          // Below the floating buttons, not under them.
          indicator = {
            PullToRefreshDefaults.Indicator(
              state = pull, isRefreshing = refreshing, color = look.accent,
              modifier = Modifier.align(Alignment.TopCenter).padding(top = topBar),
            )
          },
          onRefresh = {
            scope.launch {
              val ids = when (spec) {
                is ListSpec.Feed -> listOf(spec.id)
                is ListSpec.Category -> library.feeds.filter { it.categoryId == spec.id }.map { it.id }
                else -> null
              }
              runCatching { reader.refresh(ids) }
            }
          },
          modifier = Modifier.fillMaxSize(),
        ) {
          LazyColumn(
            state = listState,
            contentPadding = PaddingValues(
              top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp,
              bottom = if (pushed) 40.dp else 120.dp,
            ),
            modifier = Modifier.fillMaxSize(),
          ) {
            item("header") {
              ListHeader(title, showLogo = !pushed, subtitle = subtitleFor(reader, spec))
            }
            if (loadedLibrary && library.feeds.isEmpty() && spec == ListSpec.Unread) {
              item("welcome") { Welcome(reader, nav) }
            } else if (pages.loaded && pages.items.isEmpty()) {
              item("empty") { EmptyList(spec, unreadOnly) }
            }
            items(pages.items, key = { it.id }) { article ->
              SwipeRow(
                article,
                onToggleRead = { scope.launch { reader.setRead(listOf(article), !article.read) } },
                onToggleStar = { scope.launch { reader.setStarred(article, !article.starred) } },
              ) {
                ArticleRow(
                  article, reader.feed(feedIdOf(article)), showFeed = spec !is ListSpec.Feed, showImage = listImages,
                  modifier = Modifier.clickable { nav.article(article.id) },
                )
              }
              Divider(20.dp)
            }
            if (pages.loading && pages.items.isNotEmpty()) {
              item("more") {
                Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                  CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = look.accent)
                }
              }
            }
          }
        }
      }
      TopScrim()
      Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (pushed) GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
        Spacer(Modifier.weight(1f))
        GlassCapsule {
          if (spec !is ListSpec.Starred && spec != ListSpec.Unread) {
            CapsuleButton(
              if (unreadOnly) Icons.Rounded.FilterList else Icons.Rounded.FilterListOff,
              stringResource(if (unreadOnly) R.string.show_all else R.string.show_unread),
            ) { unreadOnly = !unreadOnly }
          }
          if (spec !is ListSpec.Starred) {
            CapsuleButton(Icons.Rounded.DoneAll, stringResource(R.string.mark_all_read), enabled = pages.items.any { !it.read }) {
              scope.launch {
                when (spec) {
                  is ListSpec.Feed -> reader.markAllRead(feed = spec.id)
                  is ListSpec.Category -> reader.markAllRead(category = spec.id)
                  else -> reader.markAllRead()
                }
              }
            }
          }
          if (refreshing) {
            Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
              CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = look.text)
            }
          } else {
            CapsuleButton(Icons.Rounded.Refresh, stringResource(R.string.refresh)) {
              scope.launch { runCatching { reader.refresh() } }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun subtitleFor(reader: Reader, spec: ListSpec): String? {
  val unread by reader.unread.collectAsState()
  val starred by reader.starred.collectAsState()
  val library by reader.library.collectAsState()
  val n = when (spec) {
    ListSpec.Unread, ListSpec.All -> unread.values.sum()
    ListSpec.Starred -> return if (starred > 0) stringResource(R.string.n_starred, starred) else null
    is ListSpec.Feed -> {
      reader.feed(spec.id)?.lastError?.let { return stringResource(R.string.feed_error, it) }
      unread[spec.id] ?: 0
    }
    is ListSpec.Category -> library.feeds.filter { it.categoryId == spec.id }.sumOf { unread[it.id] ?: 0 }
  }
  val offline = reader.server?.offline?.collectAsState()?.value == true
  if (offline) return stringResource(R.string.offline_now)
  return if (n > 0) stringResource(R.string.n_unread, n) else null
}

/** The big title at the top of a list, scrolling with it, as on the iPhone. */
@Composable
fun ListHeader(title: String, showLogo: Boolean, subtitle: String? = null) {
  val look = LocalLook.current
  Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 8.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      if (showLogo) PerchMark(30.dp)
      Text(title, color = look.text, fontSize = 32.sp, fontWeight = FontWeight.Bold, lineHeight = 36.sp, maxLines = 2)
    }
    if (subtitle != null) {
      Text(subtitle, color = look.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 2.dp))
    }
  }
}

/** Fades the content out under the status bar so the floating buttons stay readable. */
@Composable
fun TopScrim(height: Dp = 56.dp) {
  val look = LocalLook.current
  val bar = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
  Box(
    Modifier.fillMaxWidth().height(bar + height).background(
      Brush.verticalGradient(
        0f to look.background,
        (bar / (bar + height)).coerceIn(0f, 1f) to look.background.copy(alpha = 0.92f),
        1f to Color.Transparent,
      ),
    ),
  )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SwipeRow(
  article: Article,
  onToggleRead: () -> Unit,
  onToggleStar: () -> Unit,
  content: @Composable () -> Unit,
) {
  val look = LocalLook.current
  val state = rememberSwipeToDismissBoxState()
  LaunchedEffect(state.currentValue) {
    when (state.currentValue) {
      SwipeToDismissBoxValue.StartToEnd -> onToggleRead()
      SwipeToDismissBoxValue.EndToStart -> onToggleStar()
      SwipeToDismissBoxValue.Settled -> return@LaunchedEffect
    }
    state.snapTo(SwipeToDismissBoxValue.Settled)
  }
  SwipeToDismissBox(
    state = state,
    backgroundContent = {
      // Nothing at rest: the row is see-through so the backdrop shows.
      if (state.dismissDirection == SwipeToDismissBoxValue.Settled) return@SwipeToDismissBox
      val toRead = state.dismissDirection == SwipeToDismissBoxValue.StartToEnd
      Box(
        Modifier.fillMaxSize().background(if (toRead) look.accent.copy(alpha = 0.18f) else look.accent.copy(alpha = 0.28f))
          .padding(horizontal = 24.dp),
        contentAlignment = if (toRead) Alignment.CenterStart else Alignment.CenterEnd,
      ) {
        val icon = when {
          toRead -> if (article.read) Icons.Rounded.MarkEmailUnread else Icons.Rounded.MarkEmailRead
          article.starred -> Icons.Rounded.StarOutline
          else -> Icons.Rounded.Star
        }
        Icon(icon, null, tint = look.accentText)
      }
    },
  ) {
    // Opaque only while swiping, so the backdrop's glow shows through at rest.
    val swiping = state.dismissDirection != SwipeToDismissBoxValue.Settled
    Box(Modifier.background(if (swiping) look.background else Color.Transparent)) { content() }
  }
}

@Composable
private fun EmptyList(spec: ListSpec, unreadOnly: Boolean) {
  val look = LocalLook.current
  val text = when {
    spec == ListSpec.Starred -> stringResource(R.string.empty_starred)
    unreadOnly || spec == ListSpec.Unread -> stringResource(R.string.empty_unread)
    else -> stringResource(R.string.empty_list)
  }
  Text(
    text, color = look.muted, fontSize = 15.sp, lineHeight = 21.sp,
    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 40.dp),
  )
}
