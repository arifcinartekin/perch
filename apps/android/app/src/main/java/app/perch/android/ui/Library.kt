package app.perch.android.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Explore
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Category
import app.perch.android.core.Feed
import app.perch.android.core.UNCATEGORIZED_ID
import kotlinx.coroutines.launch

/** Feeds: all articles, starred, then each category with its feeds. */
@Composable
fun LibraryScreen(reader: Reader, nav: Nav) {
  val look = LocalLook.current
  val haze = LocalHaze.current!!
  val scope = rememberCoroutineScope()
  val library by reader.library.collectAsState()
  val unread by reader.unread.collectAsState()
  val starred by reader.starred.collectAsState()
  var adding by remember { mutableStateOf(false) }
  val uncategorizedName = stringResource(R.string.uncategorized)

  // Categories in order, with the uncategorized group last when it has feeds.
  val groups = remember(library, uncategorizedName) {
    val byCategory = library.feeds.groupBy { it.categoryId }
    val known = library.categories.filter { it.id != UNCATEGORIZED_ID }.sortedBy { it.order }
    val list = known.map { it to byCategory[it.id].orEmpty().sortedBy { f -> f.displayTitle.lowercase() } }.toMutableList()
    val loose = library.feeds.filter { f -> f.categoryId == UNCATEGORIZED_ID || known.none { it.id == f.categoryId } }
    if (loose.isNotEmpty()) {
      val stored = library.categories.firstOrNull { it.id == UNCATEGORIZED_ID }
      list.add(Category(UNCATEGORIZED_ID, uncategorizedName, 1e6, stored?.collapsed) to loose.sortedBy { it.displayTitle.lowercase() })
    }
    list
  }

  Box(Modifier.fillMaxSize()) {
    GlassSource(haze) {
      LazyColumn(
        contentPadding = PaddingValues(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp, bottom = 120.dp),
      ) {
        item { ListHeader(stringResource(R.string.tab_feeds), showLogo = true) }
        item {
          Section(null) {
            NavRow(Icons.Rounded.Inbox, stringResource(R.string.all_articles), unread.values.sum()) { nav.all() }
            Divider(52.dp)
            NavRow(Icons.Rounded.Star, stringResource(R.string.tab_starred), starred) { nav.starredFromLibrary() }
            Divider(52.dp)
            val notes by reader.notes.collectAsState()
            NavRow(Icons.Rounded.EditNote, stringResource(R.string.notes), notes.size) { nav.notes() }
          }
        }
        if (library.feeds.isEmpty()) {
          item {
            Text(
              stringResource(R.string.no_feeds), color = look.muted, fontSize = 15.sp, lineHeight = 21.sp,
              modifier = Modifier.padding(20.dp),
            )
          }
        }
        for ((category, feeds) in groups) {
          item(key = "c:" + category.id) {
            CategoryHeader(
              reader, category, feeds.sumOf { unread[it.id] ?: 0 },
              onOpen = { nav.category(category.id) },
              onToggle = { scope.launch { reader.setCollapsed(category.id, category.collapsed != true) } },
            )
          }
          if (category.collapsed != true && feeds.isNotEmpty()) {
            item(key = "f:" + category.id) {
              Section(null) {
                feeds.forEachIndexed { i, feed ->
                  if (i > 0) Divider(52.dp)
                  FeedRow(reader, feed, unread[feed.id] ?: 0) { nav.feed(feed.id) }
                }
              }
            }
          }
        }
      }
    }
    TopScrim()
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
      Spacer(Modifier.weight(1f))
      GlassCapsule {
        CapsuleButton(Icons.Rounded.Explore, stringResource(R.string.explore)) { nav.explore() }
        CapsuleButton(Icons.Rounded.Add, stringResource(R.string.add_feed)) { adding = true }
      }
    }
  }
  if (adding) AddFeedSheet(reader, onDismiss = { adding = false })
}

@Composable
private fun NavRow(icon: ImageVector, title: String, count: Int, onClick: () -> Unit) {
  val look = LocalLook.current
  Row(
    Modifier.fillMaxWidth().combinedClickableCompat(onClick).padding(horizontal = 16.dp, vertical = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(icon, null, tint = look.accentText, modifier = Modifier.size(22.dp))
    Spacer(Modifier.size(14.dp))
    Text(title, color = look.text, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
    if (count > 0) Text(count.toString(), color = look.faint, fontSize = 15.sp)
    Icon(Icons.Rounded.ChevronRight, null, tint = look.faint)
  }
}

@Composable
private fun CategoryHeader(reader: Reader, category: Category, unread: Int, onOpen: () -> Unit, onToggle: () -> Unit) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  var menu by remember { mutableStateOf(false) }
  var confirmDelete by remember { mutableStateOf(false) }
  Box {
    Row(
      Modifier.fillMaxWidth().combinedClickableCompat(onOpen, onLong = { menu = true })
        .padding(start = 32.dp, end = 20.dp, top = 20.dp, bottom = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        category.name.uppercase(), color = look.faint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp, modifier = Modifier.weight(1f),
      )
      if (unread > 0) Text(unread.toString(), color = look.faint, fontSize = 12.sp)
      Icon(
        Icons.Rounded.ExpandMore, stringResource(R.string.collapse), tint = look.faint,
        modifier = Modifier.size(28.dp).rotate(if (category.collapsed == true) -90f else 0f).combinedClickableCompat(onToggle).padding(4.dp),
      )
    }
    DropdownMenu(menu, onDismissRequest = { menu = false }) {
      DropdownMenuItem({ Text(stringResource(R.string.mark_all_read)) }, onClick = {
        menu = false
        scope.launch { reader.markAllRead(category = category.id) }
      })
      if (category.id != UNCATEGORIZED_ID) {
        DropdownMenuItem({ Text(stringResource(R.string.delete_category)) }, onClick = {
          menu = false
          confirmDelete = true
        })
      }
    }
  }
  if (confirmDelete) {
    AlertDialog(
      onDismissRequest = { confirmDelete = false },
      title = { Text(stringResource(R.string.delete_category_title, category.name)) },
      text = { Text(stringResource(R.string.delete_category_text)) },
      confirmButton = {
        TextButton({
          confirmDelete = false
          scope.launch { reader.deleteCategory(category.id) }
        }) { Text(stringResource(R.string.delete)) }
      },
      dismissButton = { TextButton({ confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
}

@Composable
private fun FeedRow(reader: Reader, feed: Feed, unread: Int, onClick: () -> Unit) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  val library by reader.library.collectAsState()
  var menu by remember { mutableStateOf(false) }
  var renaming by remember { mutableStateOf(false) }
  var moving by remember { mutableStateOf(false) }
  var removing by remember { mutableStateOf(false) }
  Box {
    Row(
      Modifier.fillMaxWidth().combinedClickableCompat(onClick, onLong = { menu = true }).padding(horizontal = 16.dp, vertical = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      FeedIcon(feed, 22.dp)
      Spacer(Modifier.size(14.dp))
      Text(feed.displayTitle, color = look.text, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
      if (feed.lastError != null) {
        Icon(Icons.Rounded.ErrorOutline, stringResource(R.string.feed_error, feed.lastError), tint = look.faint, modifier = Modifier.size(18.dp))
        Spacer(Modifier.size(6.dp))
      }
      if (unread > 0) Text(unread.toString(), color = look.faint, fontSize = 15.sp)
    }
    DropdownMenu(menu, onDismissRequest = { menu = false }) {
      DropdownMenuItem({ Text(stringResource(R.string.mark_all_read)) }, onClick = {
        menu = false
        scope.launch { reader.markAllRead(feed = feed.id) }
      })
      DropdownMenuItem({ Text(stringResource(R.string.rename)) }, onClick = { menu = false; renaming = true })
      DropdownMenuItem({ Text(stringResource(R.string.move_to_category)) }, onClick = { menu = false; moving = true })
      DropdownMenuItem({ Text(stringResource(R.string.remove)) }, onClick = { menu = false; removing = true })
    }
  }
  if (renaming) {
    var name by remember { mutableStateOf(feed.customTitle ?: feed.displayTitle) }
    AlertDialog(
      onDismissRequest = { renaming = false },
      title = { Text(stringResource(R.string.rename)) },
      text = { OutlinedTextField(name, { name = it }, singleLine = true, placeholder = { Text(feed.title) }) },
      confirmButton = {
        TextButton({
          renaming = false
          scope.launch { reader.renameFeed(feed.id, if (name.trim() == feed.title) "" else name.trim()) }
        }) { Text(stringResource(R.string.save)) }
      },
      dismissButton = { TextButton({ renaming = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
  if (moving) {
    var newName by remember { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { moving = false },
      title = { Text(stringResource(R.string.move_to_category)) },
      text = {
        Column {
          val choices = listOf(Category(UNCATEGORIZED_ID, stringResource(R.string.uncategorized), 1e6)) +
            library.categories.filter { it.id != UNCATEGORIZED_ID }.sortedBy { it.order }
          for (c in choices) {
            Text(
              c.name, color = if (c.id == feed.categoryId) look.accentText else look.text, fontSize = 16.sp,
              modifier = Modifier.fillMaxWidth().combinedClickableCompat({
                moving = false
                scope.launch { reader.moveFeed(feed.id, c.id) }
              }).padding(vertical = 10.dp),
            )
          }
          OutlinedTextField(newName, { newName = it }, singleLine = true, label = { Text(stringResource(R.string.new_category)) })
        }
      },
      confirmButton = {
        TextButton(enabled = newName.isNotBlank(), onClick = {
          moving = false
          scope.launch { reader.moveFeed(feed.id, reader.addCategory(newName).id) }
        }) { Text(stringResource(R.string.move)) }
      },
      dismissButton = { TextButton({ moving = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
  if (removing) {
    AlertDialog(
      onDismissRequest = { removing = false },
      title = { Text(stringResource(R.string.remove_feed_title, feed.displayTitle)) },
      text = { Text(stringResource(R.string.remove_feed_text)) },
      confirmButton = {
        TextButton({
          removing = false
          scope.launch { reader.removeFeed(feed.id) }
        }) { Text(stringResource(R.string.remove)) }
      },
      dismissButton = { TextButton({ removing = false }) { Text(stringResource(R.string.cancel)) } },
    )
  }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit, onLong: (() -> Unit)? = null) =
  this.combinedClickable(onClick = onClick, onLongClick = onLong)
