// Why one root knob: every block type multiplies its own base font/line-height
// by the same `textScale` rather than each having a bespoke scaled variant —
// one number scales headings, prose, code, quotes and table cells together.
export function scaledTextStyle(
  fontSize: number,
  lineHeight: number | undefined,
  textScale: number
): { fontSize: number; lineHeight?: number } | null {
  if (textScale === 1) {
    return null
  }
  return lineHeight == null
    ? { fontSize: fontSize * textScale }
    : { fontSize: fontSize * textScale, lineHeight: lineHeight * textScale }
}

// Why: at the default scale, keep `style` the same plain object callers already got
// (some tests read style props without RN's StyleSheet.flatten) instead of always
// wrapping it in a single-purpose array.
export function withScale<T>(base: T, scale: object | null): T | [T, object] {
  return scale ? [base, scale] : base
}

// Base sizes mirror mobile-markdown-styles.ts; inline spans (bold/italic/links)
// inherit fontSize from their wrapping Text, so only styles that set their own
// fontSize need an explicit scaled variant.
// Why two modes: chat scales only paragraphs and lists (its original behaviour, which
// must not change); the Markdown viewers pass `scaleAllBlocks` to scale every block.
export function getMarkdownBlockScales(textScale: number, scaleAllBlocks = false) {
  const other = scaleAllBlocks ? textScale : 1
  return {
    prose: scaledTextStyle(13, 19, textScale),
    heading: scaledTextStyle(14, 20, other),
    headingLarge: scaledTextStyle(15, 21, other),
    quote: scaledTextStyle(13, 19, other),
    codeLanguage: scaledTextStyle(10, undefined, other),
    codeText: scaledTextStyle(12, 17, other),
    imageCaption: scaledTextStyle(11, undefined, other),
    tableCell: scaledTextStyle(12, 17, other),
    tableTruncated: scaledTextStyle(12, undefined, other),
    listMarker: scaledTextStyle(13, 19, other),
    list: scaledTextStyle(14, 20, textScale)
  }
}
