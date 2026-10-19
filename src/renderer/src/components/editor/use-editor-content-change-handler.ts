import { useCallback, useLayoutEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { DiffContent, FileContent } from './editor-panel-content-types'
import { isEditorContentUnchanged } from './editor-content-dirty-state'

/**
 * Builds the editor's content-change handler: record the draft, then reconcile
 * the dirty flag against the content the file was loaded with.
 *
 * Why the refs: depending on the loaded-content maps directly churned the
 * callback identity on every content load, pushing fresh props through the
 * whole memoized editor subtree. They are written in a layout effect rather
 * than during render because a render React discards must not move the
 * dirty-check baseline, and a committed one lands before any input event can
 * reach the handler.
 */
export function useEditorContentChangeHandler({
  fileContents,
  diffContents
}: {
  fileContents: Record<string, FileContent>
  diffContents: Record<string, DiffContent>
}): (file: OpenFile | null, content: string) => void {
  const markFileDirty = useAppStore((s) => s.markFileDirty)
  const setEditorDraft = useAppStore((s) => s.setEditorDraft)
  const anchorEditBaseline = useAppStore((s) => s.anchorEditBaseline)
  const fileContentsRef = useRef(fileContents)
  const diffContentsRef = useRef(diffContents)
  useLayoutEffect(() => {
    fileContentsRef.current = fileContents
    diffContentsRef.current = diffContents
  }, [diffContents, fileContents])

  return useCallback(
    (file: OpenFile | null, content: string) => {
      if (
        !file ||
        !useAppStore.getState().openFiles.some((candidate) => candidate.id === file.id)
      ) {
        return
      }
      setEditorDraft(file.id, content)
      const ignoreTrailingWhitespace = file.language === 'markdown'
      // Why: split panels cache content separately while the baseline is shared; an edit must be
      // guarded against the text this panel showed, not a newer load another panel made.
      const markEdited = (original: string, displayedFromDisk: boolean): void => {
        const dirty = !isEditorContentUnchanged(content, original, ignoreTrailingWhitespace)
        if (dirty && displayedFromDisk) {
          anchorEditBaseline(file.id, original)
        }
        markFileDirty(file.id, dirty)
      }
      if (file.mode === 'edit') {
        const loaded = fileContentsRef.current[file.id]
        markEdited(
          loaded?.content ?? '',
          loaded !== undefined && !loaded.isBinary && !loaded.loadError && !loaded.csvPreview
        )
        return
      }
      const diffContent = diffContentsRef.current[file.id]
      markEdited(
        diffContent?.kind === 'text' ? diffContent.modifiedContent : '',
        diffContent?.kind === 'text' &&
          file.diffSource === 'unstaged' &&
          !diffContent.largeDiffRenderLimit?.limited
      )
    },
    [anchorEditBaseline, markFileDirty, setEditorDraft]
  )
}
