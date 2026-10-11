package app.perch.android.ui

import android.content.Context
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import app.perch.android.R
import java.io.OutputStream
import java.text.DateFormat
import java.util.Date

/** The recovery code as a one-page A4 PDF to keep or print (the iPhone app's page, drawn here). */
object RecoveryPdf {
  fun write(context: Context, username: String, server: String, code: String, out: OutputStream) {
    val doc = PdfDocument()
    val page = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
    val c = page.canvas
    val ink = 0xFF12151C.toInt()
    val muted = 0xFF555A66.toInt()
    val ember = 0xFFFF7A1A.toInt()
    fun paint(size: Float, color: Int, bold: Boolean = false, mono: Boolean = false) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = size
      this.color = color
      typeface = Typeface.create(if (mono) Typeface.MONOSPACE else Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
    }
    var y = 72f
    val left = 64f
    val width = 595 - 2 * left
    fun block(text: String, p: TextPaint, after: Float = 10f) {
      val layout = StaticLayout.Builder.obtain(text, 0, text.length, p, width.toInt()).setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(0f, 1.25f).build()
      c.save()
      c.translate(left, y)
      layout.draw(c)
      c.restore()
      y += layout.height + after
    }
    c.drawRect(left, y - 24, left + 40, y - 20, Paint().apply { color = ember })
    block(context.getString(R.string.pdf_title), paint(28f, ink, bold = true), 4f)
    val host = runCatching { java.net.URI(server).host }.getOrNull() ?: server
    block(context.getString(R.string.pdf_for, username, host), paint(13f, muted), 28f)
    block(code, paint(26f, ink, bold = true, mono = true), 8f)
    block(context.getString(R.string.pdf_made, DateFormat.getDateInstance(DateFormat.LONG).format(Date())), paint(11f, muted), 32f)
    block(context.getString(R.string.pdf_keep_title), paint(15f, ink, bold = true), 6f)
    block(context.getString(R.string.pdf_keep), paint(12f, ink), 22f)
    block(context.getString(R.string.pdf_use_title), paint(15f, ink, bold = true), 6f)
    block(context.getString(R.string.pdf_use), paint(12f, ink), 40f)
    block("perch.ws · " + context.getString(R.string.pdf_private), paint(10f, muted))
    doc.finishPage(page)
    doc.writeTo(out)
    doc.close()
  }
}
