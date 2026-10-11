package app.perch.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Article
import app.perch.android.data.LocalBackend
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.delay

/** Search every article on the phone, with the field in a glass bar at the bottom. */
@Composable
fun SearchScreen(reader: Reader, nav: Nav) {
  val look = LocalLook.current
  val haze = rememberHazeState()
  var query by rememberSaveable { mutableStateOf("") }
  var results by remember { mutableStateOf<List<Article>>(emptyList()) }
  val listImages by reader.device.listImages.collectAsState()
  val focus = remember { FocusRequester() }

  LaunchedEffect(query) {
    if (query.isBlank()) {
      results = emptyList()
      return@LaunchedEffect
    }
    delay(250)
    results = reader.backend.articles(LocalBackend.Scope.ALL, search = query, limit = 100)
  }
  LaunchedEffect(Unit) { reader.updates.collect { u -> results = results.map { if (it.id == u.id) u else it } } }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize().imePadding()) {
      GlassSource(haze) {
        LazyColumn(
          contentPadding = PaddingValues(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp, bottom = 110.dp),
        ) {
          item { ListHeader(stringResource(R.string.search), showLogo = false) }
          if (query.isNotBlank() && results.isEmpty()) {
            item {
              Text(stringResource(R.string.no_results), color = look.muted, fontSize = 15.sp, modifier = Modifier.padding(20.dp))
            }
          }
          items(results, key = { it.id }) { a ->
            ArticleRow(a, reader.feed(a.feedId), showFeed = true, showImage = listImages, modifier = Modifier.clickable { nav.article(a.id) })
            Divider(20.dp)
          }
        }
      }
      TopScrim()
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
      }
      Row(
        Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(16.dp)
          .height(56.dp).glass(RoundedCornerShape(28.dp)).padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(Icons.Rounded.Search, null, tint = look.muted, modifier = Modifier.size(22.dp))
        Spacer(Modifier.size(10.dp))
        Box(Modifier.weight(1f)) {
          if (query.isEmpty()) Text(stringResource(R.string.search_hint), color = look.faint, fontSize = 17.sp)
          BasicTextField(
            query, { query = it }, singleLine = true,
            textStyle = TextStyle(color = look.text, fontSize = 17.sp),
            cursorBrush = SolidColor(look.accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier.fillMaxWidth().focusRequester(focus),
          )
        }
      }
    }
  }
}
