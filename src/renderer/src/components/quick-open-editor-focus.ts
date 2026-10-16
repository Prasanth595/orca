// Why: Go to file closes a focus-trapped dialog. Cmd+F only reaches the editor
// while that editor holds keyboard focus (issue #29226).
const OPENED_EDITOR_FOCUS_SELECTORS = [
  '.monaco-editor textarea',
  '.rich-markdown-editor[contenteditable="true"]',
  '.markdown-preview'
]

export function focusOpenedEditorSurface(doc: Document = document): boolean {
  for (const selector of OPENED_EDITOR_FOCUS_SELECTORS) {
    const target = doc.querySelector(selector)
    if (!(target instanceof HTMLElement)) {
      continue
    }
    target.focus()
    if (doc.activeElement === target || target.contains(doc.activeElement)) {
      return true
    }
  }
  return false
}

export function completeQuickOpenEditorHandoff(event: Event, openedFile: boolean): void {
  event.preventDefault()
  if (!openedFile) {
    return
  }
  const focus = (): void => {
    focusOpenedEditorSurface()
  }
  focus()
  requestAnimationFrame(() => {
    requestAnimationFrame(focus)
  })
}
