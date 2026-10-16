import type MarkdownIt from 'markdown-it'

/** Raw source ranges; a closing backtick run must have exactly the opener's length. */
function mobileMarkdownInlineCodeSpans(source: string): { start: number; end: number }[] {
  const markers = [...source.matchAll(/`+/g)]
  const nextByLength = new Map<number, number>()
  const closers: { plain: number | undefined; escaped: number | undefined }[] = []
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index]!
    closers[index] = {
      plain: nextByLength.get(marker[0].length),
      escaped: nextByLength.get(marker[0].length - 1)
    }
    nextByLength.set(marker[0].length, index)
  }
  const spans: { start: number; end: number }[] = []
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]!
    let escapes = 0
    for (let before = marker.index - 1; before >= 0 && source[before] === '\\'; before -= 1) {
      escapes += 1
    }
    // An escaped first backtick leaves the rest of its run available as an opener.
    const escaped = escapes % 2
    const length = marker[0].length - escaped
    if (length === 0) {
      continue
    }
    const close = escaped ? closers[index]?.escaped : closers[index]?.plain
    if (close !== undefined) {
      const closing = markers[close]!
      spans.push({ start: marker.index + escaped, end: closing.index + closing[0].length })
      index = close
    }
  }
  return spans
}

/** Literal code ranges in original source, including multiline inline spans. */
export function collectMobileMarkdownLiteralRanges(
  source: string,
  tokens: ReturnType<MarkdownIt['parse']>
): { start: number; end: number }[] {
  let offset = 0
  const lines = source.split('\n').map((line) => {
    const start = offset
    offset += line.length + 1
    return start
  })
  const ranges: { start: number; end: number }[] = []
  for (const token of tokens) {
    if (!token.map) {
      continue
    }
    const start = lines[token.map[0]] ?? source.length
    const end = lines[token.map[1]] ?? source.length
    if (token.type === 'fence' || token.type === 'code_block') {
      ranges.push({ start, end })
    } else if (
      token.type === 'inline' &&
      token.children?.some((child) => child.type === 'code_inline')
    ) {
      ranges.push(
        ...mobileMarkdownInlineCodeSpans(source.slice(start, end)).map((span) => ({
          start: start + span.start,
          end: start + span.end
        }))
      )
    }
  }
  return ranges.sort((a, b) => a.start - b.start)
}
