const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** Plane stores comments as HTML; the user's text is escaped and newlines become `<br>`. */
export function planeCommentHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (char) => ESCAPES[char])
  return `<p>${escaped.replace(/\r\n|\r|\n/g, '<br>')}</p>`
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' '
}

/**
 * Fallback when Plane omits its own stripped text. The result is shown as text, never as
 * HTML, so this only has to be readable, not safe.
 */
export function planeHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_match, name: string) => ENTITIES[name])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
