package app.perch.android.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Article
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.Notes
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.TextFields
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.perch.android.R
import app.perch.android.Reader
import app.perch.android.core.Article
import app.perch.android.core.FullText
import app.perch.android.core.HtmlText
import dev.chrisbanes.haze.rememberHazeState
import kotlinx.coroutines.launch

/**
 * One article, in a WebView with JavaScript off and a strict content policy:
 * the page can show text, pictures and video, and run nothing. Full text loads
 * by itself when the feed gives only a summary.
 */
@Composable
fun ArticleScreen(reader: Reader, nav: Nav, id: String) {
  val look = LocalLook.current
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val haze = rememberHazeState()
  val snackbar = remember { SnackbarHostState() }
  var article by remember { mutableStateOf<Article?>(null) }
  var fullText by remember { mutableStateOf<FullText?>(null) }
  var showFull by remember { mutableStateOf(false) }
  var loadingFull by remember { mutableStateOf(false) }
  var noting by remember { mutableStateOf(false) }
  val notes by reader.notes.collectAsState()
  var styling by remember { mutableStateOf(false) }
  val textSize by reader.device.textSize.collectAsState()
  val lineHeight by reader.device.lineHeight.collectAsState()
  val noText = stringResource(R.string.error_no_article_text)

  fun loadFull(force: Boolean = false) {
    val a = article ?: return
    loadingFull = true
    scope.launch {
      try {
        fullText = reader.fullText(a, force)
        showFull = true
      } catch (e: Exception) {
        if (force) snackbar.showSnackbar(noText)
      } finally {
        loadingFull = false
      }
    }
  }

  LaunchedEffect(id) {
    val a = reader.backend.article(id) ?: return@LaunchedEffect
    article = a
    if (!a.read) {
      reader.setRead(listOf(a), true)
      article = a.copy(read = true)
    }
    reader.backend.cachedFullText(a)?.let {
      fullText = it
      showFull = true
    }
    // A summary only: fetch the page's text.
    val body = a.contentHtml ?: a.summaryHtml ?: ""
    if (fullText == null && HtmlText.plain(body, 2000).length < 600 && a.url != null) loadFull()
  }

  val topInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
  val a = article
  CompositionLocalProvider(LocalHaze provides haze) {
    Box(Modifier.fillMaxSize()) {
      GlassSource(haze) {
        if (a != null) {
          val html = remember(a, fullText, showFull, look, textSize, lineHeight) {
            articleHtml(
              a, reader.feed(a.feedId)?.displayTitle, if (showFull) fullText else null, look, topInset.value,
              notes.firstOrNull { it.id == a.id }?.body, textSize, lineHeight,
            )
          }
          ArticleWebView(html, a.url)
        }
      }
      TopScrim()
      Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        GlassIconButton(Icons.AutoMirrored.Rounded.ArrowBack, stringResource(R.string.back)) { nav.back() }
        Spacer(Modifier.weight(1f))
        if (a != null) {
          GlassCapsule {
            if (loadingFull) {
              Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = look.text)
              }
            } else if (a.url != null) {
              CapsuleButton(
                if (showFull) Icons.Rounded.Notes else Icons.AutoMirrored.Rounded.Article,
                stringResource(if (showFull) R.string.feed_version else R.string.full_text),
              ) { if (showFull) showFull = false else if (fullText != null) showFull = true else loadFull(force = true) }
            }
            CapsuleButton(Icons.Rounded.TextFields, stringResource(R.string.text_style)) { styling = true }
            CapsuleButton(
              Icons.Rounded.EditNote, stringResource(R.string.note),
              tint = if (notes.any { it.id == a.id }) look.accent else look.text,
            ) { noting = true }
            CapsuleButton(
              if (a.starred) Icons.Rounded.Star else Icons.Rounded.StarOutline,
              stringResource(if (a.starred) R.string.unstar else R.string.star),
              tint = if (a.starred) look.accent else look.text,
            ) {
              scope.launch {
                reader.setStarred(a, !a.starred)
                article = a.copy(starred = !a.starred)
              }
            }
            if (a.url != null) {
              CapsuleButton(Icons.Rounded.Share, stringResource(R.string.share)) {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                  .putExtra(Intent.EXTRA_SUBJECT, a.displayTitle).putExtra(Intent.EXTRA_TEXT, a.url)
                context.startActivity(Intent.createChooser(send, null))
              }
              CapsuleButton(Icons.Rounded.OpenInBrowser, stringResource(R.string.open_in_browser)) {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(a.url))) }
              }
            }
          }
        }
      }
      SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp))
    }
  }
  if (noting && a != null) NoteSheet(reader, nav, a) { noting = false }
  if (styling) TextStyleSheet(reader) { styling = false }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ArticleWebView(html: String, baseUrl: String?) {
  AndroidView(
    modifier = Modifier.fillMaxSize(),
    factory = { context ->
      // The article view never keeps cookies, so sites can't recognise a reader.
      CookieManager.getInstance().setAcceptCookie(false)
      WebView(context).apply {
        setBackgroundColor(AndroidColor.TRANSPARENT)
        settings.javaScriptEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.domStorageEnabled = false
        settings.setGeolocationEnabled(false)
        settings.mediaPlaybackRequiresUserGesture = true
        isVerticalScrollBarEnabled = false
        webViewClient = object : WebViewClient() {
          // Links open in the browser; the reader only ever shows the article.
          override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto") {
              runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, url)) }
            }
            return true
          }
        }
      }
    },
    update = { view ->
      if (view.tag != html) {
        view.tag = html
        view.loadDataWithBaseURL(baseUrl ?: "about:blank", html, "text/html", "utf-8", null)
      }
    },
  )
}

/** The article as a page in the palette's colours (the iPhone app's template). */
private fun articleHtml(
  article: Article, feedTitle: String?, full: FullText?, look: PerchLook, topInset: Float, note: String?,
  textSize: Float, lineHeight: Float,
): String {
  val p = look.palette
  // A page's own headline repeats the title shown above it.
  val content = full?.html?.replaceFirst(Regex("(?is)^\\s*(<[^>]+>\\s*)*?<h1\\b[^>]*>.*?</h1>"), "")
    ?: article.contentHtml ?: article.summaryHtml ?: ""
  val words = HtmlText.plain(content, Int.MAX_VALUE).split(' ').count { it.isNotBlank() }
  val minutes = if (words > 120) "${maxOf(1, Math.round(words / 230.0))} min" else null
  val meta = listOfNotNull(feedTitle, full?.byline ?: article.author, relativeTime(article.publishedAt), minutes)
    .filter { it.isNotBlank() }.joinToString(" · ") { esc(it) }
  val font = if (look.serif) "'Noto Serif', Georgia, serif" else "system-ui, 'Roboto', sans-serif"
  val rule = if (look.dark) "rgba(255,255,255,.14)" else "rgba(0,0,0,.12)"
  val code = if (look.dark) "rgba(255,255,255,.08)" else "rgba(0,0,0,.06)"
  val title = esc(article.displayTitle)
  val heading = article.url?.let { "<a href=\"${esc(it)}\">$title</a>" } ?: title
  val top = topInset + 64
  return """
    <!doctype html>
    <html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; media-src https: http:; style-src 'unsafe-inline'; font-src https:">
    <style>
    :root { color-scheme: ${if (look.dark) "dark" else "light"}; --text: ${p.text}; --muted: ${p.textMuted}; --link: ${p.accentText}; --rule: $rule; --code: $code; }
    body { margin: 0; padding: ${top}px 20px 80px; background: transparent; color: var(--text); font-family: $font; font-size: ${textSize}px; line-height: $lineHeight; overflow-wrap: anywhere; }
    header, article { max-width: 42em; margin-left: auto; margin-right: auto; }
    header { margin-bottom: 22px; }
    .meta { font: 600 13px/1.4 system-ui, sans-serif; color: var(--muted); margin: 0 0 8px; }
    h1.title { font: 700 27px/1.2 system-ui, sans-serif; letter-spacing: -0.01em; margin: 0; }
    h1.title a { color: inherit; text-decoration: none; }
    a { color: var(--link); text-underline-offset: 2px; }
    img, video, figure, svg, table { max-width: 100%; height: auto; }
    img, video { border-radius: 10px; }
    figure { margin: 1.2em 0; } figcaption { color: var(--muted); font-size: 14px; margin-top: 6px; }
    blockquote { margin: 1em 0; padding-left: 14px; border-left: 3px solid var(--rule); color: var(--muted); }
    pre { padding: 12px; border-radius: 10px; overflow-x: auto; background: var(--code); font-size: 14px; }
    code { font: 0.9em monospace; } :not(pre) > code { background: var(--code); padding: .1em .35em; border-radius: 6px; }
    hr { border: 0; border-top: 1px solid var(--rule); }
    h1 { font-size: 1.4em; line-height: 1.25; } h2, h3, h4 { line-height: 1.3; margin: 1.5em 0 .5em; }
    iframe, form, input, button, object, embed { display: none; }
    .note { margin-top: 18px; padding: 12px 14px; border-radius: 12px; border-left: 3px solid var(--link); background: var(--code); font-size: 15px; line-height: 1.5; white-space: pre-wrap; }
    .note .label { display: block; font: 600 11px/1.4 system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; white-space: normal; }
    </style></head>
    <body>
    <header><p class="meta">$meta</p><h1 class="title">$heading</h1>${note?.let { "<div class=\"note\"><span class=\"label\">Note</span>${esc(it)}</div>" } ?: ""}</header>
    <article>$content</article>
    </body></html>
  """.trimIndent()
}

private fun esc(s: String) = HtmlText.escape(s).replace("\"", "&quot;")
