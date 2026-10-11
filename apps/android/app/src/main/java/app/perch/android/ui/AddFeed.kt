package app.perch.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.UNCATEGORIZED_ID
import app.perch.android.data.LocalBackend
import kotlinx.coroutines.launch

/** Add a feed: a feed's or a site's address, into a category. */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun AddFeedSheet(reader: Reader, initialUrl: String = "", onDismiss: () -> Unit) {
  val look = LocalLook.current
  val scope = rememberCoroutineScope()
  val library by reader.library.collectAsState()
  val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  var url by remember { mutableStateOf(initialUrl) }
  var category by remember { mutableStateOf(UNCATEGORIZED_ID) }
  var newCategory by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val focus = remember { FocusRequester() }
  val errors = mapOf(
    LocalBackend.Failure.NoFeed::class to stringResource(R.string.error_no_feed),
    LocalBackend.Failure.BadAddress::class to stringResource(R.string.error_bad_address),
  )

  fun submit() {
    if (url.isBlank() || busy) return
    busy = true
    error = null
    scope.launch {
      try {
        val categoryId = if (newCategory.isNotBlank()) reader.addCategory(newCategory).id else category
        reader.addFeed(url, categoryId)
        state.hide()
        onDismiss()
      } catch (e: Exception) {
        error = errors[e::class] ?: e.message ?: e.toString()
      } finally {
        busy = false
      }
    }
  }

  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state, containerColor = look.solid) {
    Column(
      Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 20.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text(stringResource(R.string.add_feed), color = look.text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
      OutlinedTextField(
        url, { url = it; error = null },
        modifier = Modifier.fillMaxWidth().focusRequester(focus),
        singleLine = true,
        placeholder = { Text("example.com") },
        label = { Text(stringResource(R.string.feed_or_site)) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onGo = { submit() }),
        isError = error != null,
        supportingText = { Text(error ?: stringResource(R.string.add_feed_hint)) },
      )
      Text(stringResource(R.string.category), color = look.muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val choices = listOf(UNCATEGORIZED_ID to stringResource(R.string.uncategorized)) +
          library.categories.filter { it.id != UNCATEGORIZED_ID }.sortedBy { it.order }.map { it.id to it.name }
        for ((id, name) in choices) {
          FilterChip(
            selected = newCategory.isBlank() && category == id,
            onClick = { category = id; newCategory = "" },
            label = { Text(name) },
            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = look.accent.copy(alpha = 0.2f)),
          )
        }
      }
      OutlinedTextField(
        newCategory, { newCategory = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
        label = { Text(stringResource(R.string.new_category)) },
      )
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
          onClick = ::submit, enabled = url.isNotBlank() && !busy,
          colors = ButtonDefaults.buttonColors(containerColor = look.button, contentColor = look.buttonContrast),
        ) {
          if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = look.buttonContrast)
          else Text(stringResource(R.string.add), fontWeight = FontWeight.SemiBold)
        }
      }
    }
  }
}
