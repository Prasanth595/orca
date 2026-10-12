import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import {
  createDefinitionContextLoader,
  createPublishedDefinitionFiles,
  type DefinitionContextLoader
} from './definition-context-loader'
import { createDefinitionFileRoot, isKeyInsideRoot } from './definition-file-keys'
import {
  ensureDefinitionEditorOpener,
  registerDefinitionSource,
  type DefinitionSource
} from './definition-editor-opener'
import { createMonacoDefinitionSink } from './monaco-definition-sink'
import { createRuntimeDefinitionFileHost } from './runtime-definition-file-host'

const DEFINITION_LANGUAGES = new Set(['typescript', 'javascript'])
// Why delayed: opening a tab paints first; the prefetch only matters once the user reaches for Cmd-click.
const LOAD_DELAY_MS = 300

const publishedFiles = createPublishedDefinitionFiles()
const loadersByRoot = new Map<string, DefinitionContextLoader>()
let sink: ReturnType<typeof createMonacoDefinitionSink> | null = null

/** Cmd/Ctrl-click in a TS/JS file follows a definition into another file, node_modules included. */
export function useMonacoDefinitionNavigation({
  editor: codeEditor,
  fileId,
  language
}: {
  editor: editor.IStandaloneCodeEditor | null
  fileId: string
  language: string
}): void {
  useEffect(() => {
    const model = codeEditor?.getModel()
    // Why skip owner fragments: they hide the extension from the TS worker, which then serves
    // nothing for the file (remote-owned tabs), so a prefetch would only cost host reads.
    if (!codeEditor || !model || !DEFINITION_LANGUAGES.has(language) || model.uri.fragment) {
      return
    }
    const resolved = resolveDefinitionSource(fileId)
    const fileKey = model.uri.toString()
    if (!resolved || !isKeyInsideRoot(resolved.source.root, fileKey)) {
      return
    }
    // A definition lookup creates its target's model as TypeScript; reopening a JS file reuses it.
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language)
    }
    ensureDefinitionEditorOpener(monaco)
    const unregister = registerDefinitionSource(codeEditor, resolved.source)
    const timer = window.setTimeout(() => {
      // Best effort: a failed prefetch leaves Cmd-click as it was before.
      void getDefinitionContextLoader(resolved.source, resolved.context)
        .load(fileKey, model.getValue())
        .catch(() => {})
    }, LOAD_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      unregister()
    }
  }, [codeEditor, fileId, language])
}

function resolveDefinitionSource(
  fileId: string
): { source: DefinitionSource; context: RuntimeFileOperationArgs } | null {
  const state = useAppStore.getState()
  const file = state.openFiles.find((entry) => entry.id === fileId)
  if (!file?.worktreeId) {
    return null
  }
  try {
    const context = getEditorFileOperationContext(
      state,
      file,
      state.getKnownWorktreeById(file.worktreeId)?.path ?? null
    )
    if (!context.worktreePath) {
      return null
    }
    return {
      source: {
        worktreeId: file.worktreeId,
        runtimeEnvironmentId: file.runtimeEnvironmentId ?? null,
        root: createDefinitionFileRoot(context.worktreePath)
      },
      context
    }
  } catch {
    // The owner moved or is unresolved; reads would be refused anyway.
    return null
  }
}

function getDefinitionContextLoader(
  source: DefinitionSource,
  context: RuntimeFileOperationArgs
): DefinitionContextLoader {
  sink ??= createMonacoDefinitionSink([
    monaco.typescript.typescriptDefaults,
    monaco.typescript.javascriptDefaults
  ])
  const existing = loadersByRoot.get(source.root.rootKey)
  if (existing) {
    return existing
  }
  const loader = createDefinitionContextLoader(
    createRuntimeDefinitionFileHost(context, source.root),
    source.root,
    sink,
    publishedFiles
  )
  loadersByRoot.set(source.root.rootKey, loader)
  return loader
}
