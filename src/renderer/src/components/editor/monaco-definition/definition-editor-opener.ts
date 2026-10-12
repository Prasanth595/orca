import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { getRelativePathInsideRoot } from '@/lib/path'
import { keyToFilePath, type DefinitionFileRoot } from './definition-file-keys'

export type DefinitionSource = {
  worktreeId: string
  runtimeEnvironmentId: string | null
  root: DefinitionFileRoot
}

// Keyed by the code editor a lookup starts from; a WeakMap so closed editors drop out.
const definitionSources = new WeakMap<object, DefinitionSource>()
let installedOpener: Monaco.IDisposable | null = null
let pendingRevealFrame: number | null = null

export function registerDefinitionSource(editor: object, source: DefinitionSource): () => void {
  definitionSources.set(editor, source)
  return () => {
    if (definitionSources.get(editor) === source) {
      definitionSources.delete(editor)
    }
  }
}

/**
 * The standalone editor only navigates inside its own model; a definition in another file is
 * handed to this opener, which opens that file as an Orca tab instead.
 */
export function ensureDefinitionEditorOpener(monaco: {
  editor: Pick<typeof Monaco.editor, 'registerEditorOpener'>
}): void {
  installedOpener ??= monaco.editor.registerEditorOpener({
    openCodeEditor: openDefinitionResource
  })
}

/** `false` hands the request back to Monaco: an editor this module doesn't track, or a file outside its workspace. */
export function openDefinitionResource(
  sourceEditor: object,
  resource: Monaco.Uri,
  selectionOrPosition?: Monaco.IRange | Monaco.IPosition
): boolean {
  const source = definitionSources.get(sourceEditor)
  const filePath = source ? keyToFilePath(source.root, resource.toString()) : null
  if (!source || filePath === null) {
    return false
  }
  return openDefinitionLocation(source, filePath, selectionOrPosition)
}

function openDefinitionLocation(
  source: DefinitionSource,
  filePath: string,
  selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined
): boolean {
  const relativePath = getRelativePathInsideRoot(filePath, source.root.rootPath)
  if (relativePath === null) {
    return false
  }
  const { line, column } = toLineAndColumn(selectionOrPosition)
  const store = useAppStore.getState()
  store.openFile({
    filePath,
    relativePath,
    worktreeId: source.worktreeId,
    runtimeEnvironmentId: source.runtimeEnvironmentId,
    language: detectLanguage(filePath),
    mode: 'edit'
  })
  if (pendingRevealFrame !== null) {
    cancelAnimationFrame(pendingRevealFrame)
  }
  store.setPendingEditorReveal(null)
  // Why two frames: like search results, the destination editor must mount before it can reveal.
  pendingRevealFrame = requestAnimationFrame(() => {
    pendingRevealFrame = requestAnimationFrame(() => {
      pendingRevealFrame = null
      useAppStore.getState().setPendingEditorReveal({ filePath, line, column, matchLength: 0 })
    })
  })
  return true
}

function toLineAndColumn(selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined): {
  line: number
  column: number
} {
  if (!selectionOrPosition) {
    return { line: 1, column: 1 }
  }
  if ('startLineNumber' in selectionOrPosition) {
    return { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
  }
  return { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
}
