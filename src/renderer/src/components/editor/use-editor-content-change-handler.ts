import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import { isEditorContentUnchanged } from './editor-content-dirty-state'
import { ORCA_EDITOR_FILE_SAVED_EVENT, type EditorFileSavedDetail } from './editor-autosave'

export type EditorPanelEditHandlers = {
  /** Records the draft, then reconciles the dirty flag against what this panel loaded. */
  onContentChange: (file: OpenFile | null, content: string) => void
  /** For editors (rich markdown, notebooks) that report dirtiness before their content. */
  onDirtyHint: (file: OpenFile | null, dirty: boolean) => void
}

/** The disk text this panel shows for `file`, or null when that text did not come from disk. */
function panelDiskBase(
  file: OpenFile,
  fileContents: Record<string, FileContent>,
  diffContents: Record<string, DiffContent>
): string | null {
  if (file.mode === 'edit') {
    const loaded = fileContents[file.id]
    return loaded && !loaded.isBinary && !loaded.loadError && !loaded.csvPreview
      ? loaded.content
      : null
  }
  const diff = diffContents[file.id]
  return diff?.kind === 'text' &&
    file.diffSource === 'unstaged' &&
    !diff.largeDiffRenderLimit?.limited
    ? diff.modifiedContent
    : null
}

/**
 * Builds the editor's edit handlers for one panel.
 *
 * Why the refs: depending on the loaded-content maps directly churned the
 * callback identity on every content load, pushing fresh props through the
 * whole memoized editor subtree. They are written in a passive effect, not during
 * render (a discarded render must not move the dirty-check base) and not in a
 * layout effect: editors swap in new text in their own passive effects, which run
 * before this panel's, so the base moves together with the text on screen and a
 * keystroke on the old model is compared and anchored against the old text.
 *
 * Why anchor: split panels cache content separately while a tab's disk baseline is shared, so a
 * clean tab's first edit, however it is reported, pins the baseline to the text this panel showed.
 */
export function useEditorContentChangeHandler({
  fileContents,
  diffContents
}: {
  fileContents: Record<string, FileContent>
  diffContents: Record<string, DiffContent>
}): EditorPanelEditHandlers {
  const markFileDirty = useAppStore((s) => s.markFileDirty)
  const setEditorDraft = useAppStore((s) => s.setEditorDraft)
  const anchorEditBaseline = useAppStore((s) => s.anchorEditBaseline)
  const fileContentsRef = useRef(fileContents)
  const diffContentsRef = useRef(diffContents)
  useEffect(() => {
    fileContentsRef.current = fileContents
    diffContentsRef.current = diffContents
  }, [diffContents, fileContents])

  // Why: a save rebaselines in the same tick it announces; the cache render lands later, and a
  // keystroke in between must anchor to the written text, not the pre-save load.
  useEffect(() => {
    const onSaved = (event: Event): void => {
      const detail: EditorFileSavedDetail | undefined =
        event instanceof CustomEvent ? event.detail : undefined
      if (!detail) {
        return
      }
      const loaded = fileContentsRef.current[detail.fileId]
      if (loaded) {
        fileContentsRef.current = {
          ...fileContentsRef.current,
          [detail.fileId]: { ...loaded, content: detail.content }
        }
      }
      const diff = diffContentsRef.current[detail.fileId]
      if (diff?.kind === 'text') {
        diffContentsRef.current = {
          ...diffContentsRef.current,
          [detail.fileId]: { ...diff, modifiedContent: detail.content }
        }
      }
    }
    window.addEventListener(ORCA_EDITOR_FILE_SAVED_EVENT, onSaved)
    return () => window.removeEventListener(ORCA_EDITOR_FILE_SAVED_EVENT, onSaved)
  }, [])

  const anchorToPanel = useCallback(
    (file: OpenFile): void => {
      const base = panelDiskBase(file, fileContentsRef.current, diffContentsRef.current)
      if (base !== null) {
        anchorEditBaseline(file.id, base)
      }
    },
    [anchorEditBaseline]
  )

  const onContentChange = useCallback(
    (file: OpenFile | null, content: string) => {
      if (
        !file ||
        !useAppStore.getState().openFiles.some((candidate) => candidate.id === file.id)
      ) {
        return
      }
      const original =
        file.mode === 'edit'
          ? (fileContentsRef.current[file.id]?.content ?? '')
          : (() => {
              const diff = diffContentsRef.current[file.id]
              return diff?.kind === 'text' ? diff.modifiedContent : ''
            })()
      const dirty = !isEditorContentUnchanged(content, original, file.language === 'markdown')
      // Why always, and before the draft: whatever draft this creates (even one Markdown counts as
      // clean) is based on this panel's text; anchoring is a no-op once a draft exists.
      anchorToPanel(file)
      setEditorDraft(file.id, content)
      markFileDirty(file.id, dirty)
    },
    [anchorToPanel, markFileDirty, setEditorDraft]
  )

  const onDirtyHint = useCallback(
    (file: OpenFile | null, dirty: boolean) => {
      if (!file) {
        return
      }
      if (dirty) {
        anchorToPanel(file)
      }
      markFileDirty(file.id, dirty)
    },
    [anchorToPanel, markFileDirty]
  )

  return { onContentChange, onDirtyHint }
}
