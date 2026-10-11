package app.perch.android.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material.icons.automirrored.rounded.List
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.perch.android.R
import app.perch.android.Reader
import dev.chrisbanes.haze.rememberHazeState
import java.net.URLDecoder
import java.net.URLEncoder

/** Where a screen can go: an article, a feed's or category's list, Explore, search. */
class Nav(private val controller: NavHostController) {
  fun article(id: String) = controller.navigate("article/${enc(id)}")
  fun feed(id: String) = controller.navigate("list/feed/${enc(id)}")
  fun category(id: String) = controller.navigate("list/category/${enc(id)}")
  fun all() = controller.navigate("list/all/-")
  fun starredFromLibrary() = controller.navigate("list/starred/-")
  fun explore() = controller.navigate("explore")
  fun search() = controller.navigate("search")
  fun back() = controller.popBackStack()
  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
}

private fun dec(s: String?) = URLDecoder.decode(s.orEmpty(), "UTF-8")

@Composable
fun PerchRoot(reader: Reader) {
  val controller = rememberNavController()
  val nav = remember(controller) { Nav(controller) }
  NavHost(
    controller, startDestination = "home",
    enterTransition = { slideInHorizontally(tween(320)) { it } + fadeIn(tween(220)) },
    exitTransition = { slideOutHorizontally(tween(320)) { -it / 4 } + fadeOut(tween(220)) },
    popEnterTransition = { slideInHorizontally(tween(320)) { -it / 4 } + fadeIn(tween(220)) },
    popExitTransition = { slideOutHorizontally(tween(320)) { it } + fadeOut(tween(220)) },
  ) {
    composable("home") { Home(reader, nav) }
    composable("article/{id}", listOf(navArgument("id") { type = NavType.StringType })) {
      ArticleScreen(reader, nav, dec(it.arguments?.getString("id")))
    }
    composable("list/{kind}/{id}") {
      val kind = it.arguments?.getString("kind")
      val id = dec(it.arguments?.getString("id"))
      val spec = when (kind) {
        "feed" -> ListSpec.Feed(id)
        "category" -> ListSpec.Category(id)
        "starred" -> ListSpec.Starred
        else -> ListSpec.All
      }
      ArticleListScreen(reader, nav, spec, pushed = true)
    }
    composable("explore") { ExploreScreen(reader, nav) }
    composable("search") { SearchScreen(reader, nav) }
  }
}

private enum class Tab { UNREAD, FEEDS, STARRED, SETTINGS }

/** The tabs, under a floating Liquid Glass tab bar with a separate search button. */
@Composable
private fun Home(reader: Reader, nav: Nav) {
  var tab by rememberSaveable { mutableStateOf(Tab.UNREAD) }
  val haze = rememberHazeState()
  val unread by reader.unread.collectAsState()
  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      AnimatedContent(tab, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(120)) }, label = "tab") { t ->
        when (t) {
          Tab.UNREAD -> ArticleListScreen(reader, nav, ListSpec.Unread, pushed = false)
          Tab.FEEDS -> LibraryScreen(reader, nav)
          Tab.STARRED -> ArticleListScreen(reader, nav, ListSpec.Starred, pushed = false)
          Tab.SETTINGS -> SettingsScreen(reader, nav)
        }
      }
      TabBar(
        selected = tab,
        unread = unread.values.sum(),
        onSelect = { tab = it },
        onSearch = nav::search,
        modifier = Modifier.align(Alignment.BottomCenter),
      )
    }
  }
}

@Composable
private fun TabBar(selected: Tab, unread: Int, onSelect: (Tab) -> Unit, onSearch: () -> Unit, modifier: Modifier) {
  Row(
    modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Row(
      Modifier.weight(1f).height(64.dp).glass(RoundedCornerShape(32.dp)).padding(5.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      TabItem(Icons.Rounded.Inbox, stringResource(R.string.tab_unread), selected == Tab.UNREAD, if (unread > 0) unread else null) { onSelect(Tab.UNREAD) }
      TabItem(Icons.AutoMirrored.Rounded.List, stringResource(R.string.tab_feeds), selected == Tab.FEEDS, null) { onSelect(Tab.FEEDS) }
      TabItem(Icons.Rounded.StarOutline, stringResource(R.string.tab_starred), selected == Tab.STARRED, null) { onSelect(Tab.STARRED) }
      TabItem(Icons.Rounded.Settings, stringResource(R.string.tab_settings), selected == Tab.SETTINGS, null) { onSelect(Tab.SETTINGS) }
    }
    Spacer(Modifier.width(10.dp))
    GlassIconButton(Icons.Rounded.Search, stringResource(R.string.search), size = 64.dp, onClick = onSearch)
  }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(
  icon: ImageVector,
  label: String,
  selected: Boolean,
  badge: Int?,
  onClick: () -> Unit,
) {
  val look = LocalLook.current
  val fill by animateColorAsState(if (selected) look.text.copy(alpha = if (look.dark) 0.12f else 0.07f) else Color.Transparent, label = "fill")
  val tint by animateColorAsState(if (selected) look.accentText else look.text, label = "tint")
  Column(
    Modifier.weight(1f).fillMaxSize().clip(RoundedCornerShape(27.dp)).background(fill)
      .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab, onClick = onClick),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Box {
      Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
      if (badge != null) {
        Box(
          Modifier.align(Alignment.TopEnd).offset(x = 12.dp, y = (-4).dp).clip(CircleShape).background(look.accent)
            .padding(horizontal = 5.dp, vertical = 1.dp),
        ) {
          Text(if (badge > 999) "999+" else badge.toString(), color = look.accentContrast, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
      }
    }
    Text(label, color = tint, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
  }
}
