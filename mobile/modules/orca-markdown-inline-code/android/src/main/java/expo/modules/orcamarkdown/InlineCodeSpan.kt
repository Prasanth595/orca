package expo.modules.orcamarkdown

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.text.style.ReplacementSpan

/** Decorates original characters: selection, accessibility and clipboard retain the actual code. */
internal class InlineCodeSpan(
  private val background: Int,
  private val foreground: Int,
  private val radius: Float,
  private val horizontal: Float,
  private val vertical: Float
) : ReplacementSpan() {
  override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int {
    if (fm != null) {
      paint.getFontMetricsInt(fm)
      fm.ascent -= vertical.toInt()
      fm.descent += vertical.toInt()
      fm.top = minOf(fm.top, fm.ascent)
      fm.bottom = maxOf(fm.bottom, fm.descent)
    }
    return kotlin.math.ceil(paint.measureText(text, start, end) + horizontal * 2).toInt()
  }

  override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float,
                    top: Int, y: Int, bottom: Int, paint: Paint) {
    val oldColor = paint.color
    val oldStyle = paint.style
    val width = paint.measureText(text, start, end)
    val metrics = paint.fontMetrics
    paint.color = background
    paint.style = Paint.Style.FILL
    canvas.drawRoundRect(RectF(x, y + metrics.ascent - vertical, x + width + horizontal * 2,
      y + metrics.descent + vertical), radius, radius, paint)
    paint.color = foreground
    paint.style = oldStyle
    canvas.drawText(text, start, end, x + horizontal, y.toFloat(), paint)
    paint.color = oldColor
  }
}
