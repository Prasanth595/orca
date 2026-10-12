import type { RichMarkdownEditorScope } from './document-scope'

const TEXT_SCALE_PROPERTY = '--markdown-text-scale'

/**
 * Where the CSS variable the stylesheet reads lives: the page's own host root when these modules
 * are mounted there, the WebView's `<html>` otherwise — same split as `editor-surface`'s root.
 */
function textScaleRoot(scope: RichMarkdownEditorScope): HTMLElement {
  const root = scope.root
  return root instanceof HTMLElement ? root : scope.getDocument().documentElement
}

/** One CSS variable; `document-style`'s `#editor` font-size is the only rule that reads it. */
export function setTextScale(scope: RichMarkdownEditorScope, scale: number) {
  textScaleRoot(scope).style.setProperty(TEXT_SCALE_PROPERTY, String(scale))
}
