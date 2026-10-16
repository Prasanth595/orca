package expo.modules.orcamarkdown

import android.graphics.Color
import android.text.Spannable
import android.text.SpannableString
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.BackgroundColorSpan
import android.widget.TextView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlin.math.max

class CodeRange : Record {
  @Field var start: Int = 0
  @Field var end: Int = 0
}

class OrcaMarkdownInlineCodeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaMarkdownInlineCode")
    AsyncFunction("decorateText") { tag: Int, expectedText: String, ranges: List<CodeRange>, background: String,
                                   radius: Double, horizontal: Double, vertical: Double ->
      val view = appContext.findView<TextView>(tag)
      val width = view?.let { it.width - it.compoundPaddingLeft - it.compoundPaddingRight } ?: 0
      if (view == null || width <= 0 || ranges.size > 256 || view.text.toString() != expectedText) {
        return@AsyncFunction mapOf("applied" to false, "height" to 0.0)
      }
      val density = view.resources.displayMetrics.density
      val h = horizontal.toFloat().coerceIn(0f, 8f) * density
      val v = vertical.toFloat().coerceIn(0f, 4f) * density
      val r = radius.toFloat().coerceIn(0f, 8f) * density
      val color = runCatching { Color.parseColor(background) }.getOrNull()
        ?: return@AsyncFunction mapOf("applied" to false, "height" to 0.0)
      val text = SpannableString(view.text)
      val plain = text.toString()
      text.getSpans(0, text.length, InlineCodeSpan::class.java).forEach { text.removeSpan(it) }
      for (range in ranges) {
        if (range.start < 0 || range.end > text.length || range.start >= range.end) continue
        text.getSpans(range.start, range.end, BackgroundColorSpan::class.java).forEach { span ->
          if (text.getSpanStart(span) >= range.start && text.getSpanEnd(span) <= range.end) text.removeSpan(span)
        }
        // Replacement spans are atomic. Bound each to the viewport without changing any characters.
        val paint = TextPaint(view.paint)
        text.getSpans(range.start, range.end, android.text.style.CharacterStyle::class.java)
          .forEach { it.updateDrawState(paint) }
        var start = range.start
        var newline = plain.indexOf('\n', start).let { if (it < 0) range.end else minOf(it, range.end) }
        while (start < range.end) {
          val count = paint.breakText(plain, start, range.end, true,
            max(1f, width - h * 2), null).coerceAtLeast(1)
          if (newline == start) {
            start++
            newline = plain.indexOf('\n', start).let { if (it < 0) range.end else minOf(it, range.end) }
            continue
          }
          var end = minOf(newline, start + count)
          if (end < range.end && end > start && Character.isHighSurrogate(text[end - 1])) end--
          if (end <= start) end = minOf(range.end, start + Character.charCount(Character.codePointAt(text, start)))
          if (end < range.end) {
            val space = text.subSequence(start, end).lastIndexOf(' ')
            if (space > 0) end = start + space + 1
          }
          text.setSpan(InlineCodeSpan(color, paint.color, r, h, v), start, end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
          start = end
        }
      }
      val measured = StaticLayout.Builder.obtain(text, 0, text.length, TextPaint(view.paint), width)
        .setIncludePad(view.includeFontPadding)
        .setLineSpacing(view.lineSpacingExtra, view.lineSpacingMultiplier)
        .setBreakStrategy(view.breakStrategy)
        .setHyphenationFrequency(view.hyphenationFrequency)
        .build()
      val selectionStart = view.selectionStart
      val selectionEnd = view.selectionEnd
      view.setText(text, TextView.BufferType.SPANNABLE)
      if (selectionStart >= 0 && selectionEnd >= 0) {
        android.text.Selection.setSelection(view.text as Spannable,
          selectionStart.coerceAtMost(text.length), selectionEnd.coerceAtMost(text.length))
      }
      mapOf("applied" to true, "height" to ((measured.height + view.compoundPaddingTop + view.compoundPaddingBottom) / density).toDouble())
    }.runOnQueue(Queues.MAIN)
  }
}
