package app.perch.android.ui

import android.content.Intent
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Article
import app.perch.android.data.LocalBackend
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.launch

/**
 * A note on an article, in markdown: private, syncing with the chain, and
 * shared as a public page only when you ask (through the Perch account).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteSheet(reader: Reader, nav: Nav, article: Article, onDismiss: () -> Unit) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val notes by reader.notes.collectAsState()
  val account by reader.community.account.collectAsState()
  val note = notes.firstOrNull { it.id == article.id }
  var body by remember { mutableStateOf(note?.body.orEmpty()) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val needAccount = stringResource(R.string.share_needs_account)
  val otherAccount = stringResource(R.string.share_other_account)

  fun act(block: suspend () -> Unit) {
    busy = true
    error = null
    scope.launch {
      try {
        block()
      } catch (e: IllegalStateException) {
        error = when (e.message) {
          "no-account" -> needAccount
          "other-account" -> otherAccount
          else -> e.message
        }
      } catch (e: Exception) {
        error = e.message ?: e.toString()
      } finally {
        busy = false
      }
    }
  }

  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = look.solid) {
    Column(
      Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(stringResource(R.string.note), color = look.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
      Text(article.displayTitle, color = look.muted, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
      OutlinedTextField(
        body, { body = it.take(LocalBackend.NOTE_MAX) }, modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
        placeholder = { Text(stringResource(R.string.note_placeholder)) },
      )
      note?.sharedUrl?.let { url ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Icon(Icons.Rounded.Public, null, tint = look.accentText, modifier = Modifier.size(16.dp))
          Text(
            url.removePrefix("https://"), color = look.accentText, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable {
              context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url), null))
            },
          )
        }
      }
      error?.let { Text(it, color = Color(0xFFEF4444), fontSize = 13.sp) }
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (note != null) {
          TextButton({ act { reader.deleteNote(note.id); onDismiss() } }, enabled = !busy) {
            Text(stringResource(R.string.delete), color = Color(0xFFEF4444))
          }
          if (note.sharedUrl == null) {
            TextButton({ act { reader.shareNote(note.id) } }, enabled = !busy && body == note.body) {
              Text(stringResource(R.string.share_page))
            }
          } else {
            TextButton({ act { reader.unshareNote(note.id) } }, enabled = !busy) { Text(stringResource(R.string.stop_sharing)) }
          }
        }
        Spacer(Modifier.weight(1f))
        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = look.accent)
        Button(
          { act { reader.saveNote(article, body); if (note != null) onDismiss() } },
          enabled = !busy && body.isNotBlank() && body != note?.body,
          colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
        ) { Text(stringResource(R.string.save), fontWeight = FontWeight.SemiBold) }
      }
      if (note != null && note.sharedUrl == null) {
        Text(
          if (account == null) needAccount else stringResource(R.string.share_hint, account!!.server.removePrefix("https://")),
          color = look.faint, fontSize = 12.sp, lineHeight = 16.sp,
          modifier = if (account == null) Modifier.clickable { onDismiss(); nav.account() } else Modifier,
        )
      }
    }
  }
}

/** Every note, newest first; a tap opens the article when it's still on the phone. */
@Composable
fun NotesScreen(reader: Reader, nav: Nav) {
  val look = LocalLook.current
  val haze = rememberHazeState()
  val scope = rememberCoroutineScope()
  val notes by reader.notes.collectAsState()
  var editing by remember { mutableStateOf<Article?>(null) }
  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {
        LazyColumn(
          contentPadding = PaddingValues(
            top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 64.dp,
            bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 24.dp,
          ),
        ) {
          item { ListHeader(stringResource(R.string.notes), showLogo = false) }
          if (notes.isEmpty()) {
            item { Text(stringResource(R.string.no_notes), color = look.muted, fontSize = 15.sp, lineHeight = 21.sp, modifier = Modifier.padding(20.dp)) }
          }
          items(notes, key = { it.id }) { note ->
            Column(
              Modifier.fillMaxWidth().clickable {
                scope.launch {
                  val article = reader.backend.article(note.id)
                  if (article != null) nav.article(article.id)
                  else editing = Article(note.articleId, note.feedId, note.url, note.title, null, note.createdAt, null, null, emptyList())
                }
              }.padding(horizontal = 20.dp, vertical = 12.dp),
              verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
              Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(listOfNotNull(note.feedTitle, relativeTime(note.updatedAt)).joinToString(" · "), color = look.faint, fontSize = 12.sp, modifier = Modifier.weight(1f))
                if (note.sharedUrl != null) Icon(Icons.Rounded.Public, stringResource(R.string.shared), tint = look.accentText, modifier = Modifier.size(14.dp))
              }
              Text(note.title, color = look.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
              Text(note.body, color = look.muted, fontSize = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Divider(20.dp)
          }
        }
      }
      TopScrim()
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
      }
    }
  }
  editing?.let { NoteSheet(reader, nav, it) { editing = null } }
}
