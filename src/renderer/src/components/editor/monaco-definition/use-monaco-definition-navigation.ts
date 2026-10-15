import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
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
import { createMonacoDefinitionSink, type MonacoDefinitionSink } from './monaco-definition-sink'
import { extractModuleReferences } from './module-references'
import { createRuntimeDefinitionFileHost } from './runtime-definition-file-host'

const DEFINITION_LANGUAGES = new Set(['typescript', 'javascript'])
// Why delayed: opening a tab paints first; the prefetch only matters once the user reaches for Cmd-click.
const LOAD_DELAY_MS = 300
// Why longer: typing fires per keystroke, and only a finished import line changes what to load.
const RELOAD_AFTER_EDIT_DELAY_MS = 1000

let publishedFiles = createPublishedDefinitionFiles()
const loadersByOwner = new Map<string, DefinitionContextLoader>()
let sink: MonacoDefinitionSink | null = null

/** Experimental: Cmd/Ctrl-click in a TS/JS file follows a definition into another file, node_modules included. */
export function useMonacoDefinitionNavigation({
  editor: codeEditor,
  fileId,
  language
}: {
  editor: editor.IStandaloneCodeEditor | null
  fileId: string
  language: string
}): void {
  const enabled = useAppStore((state) => state.settings?.experimentalEditorGoToDefinition === true)
  useEffect(() => {
    if (!enabled) {
      disposeDefinitionContext()
      return
    }
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
    let loadedSpecifiers: string | null = null
    let timer: number | undefined
    const scheduleLoad = (delayMs: number): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const text = model.getValue()
        // Why compare specifiers: edits that leave the imports alone would only re-read the same files.
        const specifiers = JSON.stringify(
          extractModuleReferences(text).map((reference) => reference.specifier)
        )
        if (specifiers === loadedSpecifiers) {
          return
        }
        loadedSpecifiers = specifiers
        // Best effort: a failed prefetch leaves Cmd-click as it was before.
        void getDefinitionContextLoader(resolved.source, resolved.context)
          .load(fileKey, text)
          .catch(() => {})
      }, delayMs)
    }
    scheduleLoad(LOAD_DELAY_MS)
    const contentListener = model.onDidChangeContent(() => scheduleLoad(RELOAD_AFTER_EDIT_DELAY_MS))
    // Why on focus: path aliases are worker-wide, so the worktree being edited must win a shared alias.
    const focusListener = codeEditor.onDidFocusEditorText(() =>
      sink?.preferRoot(resolved.source.root.rootKey)
    )
    return () => {
      window.clearTimeout(timer)
      contentListener.dispose()
      focusListener.dispose()
      unregister()
    }
  }, [codeEditor, enabled, fileId, language])
}

/** Turning the experiment off hands the TS worker back exactly as Monaco setup left it. */
function disposeDefinitionContext(): void {
  if (!sink) {
    return
  }
  sink.dispose()
  sink = null
  loadersByOwner.clear()
  // Replaced, not cleared: a load still in flight keeps writing to the old one.
  publishedFiles = createPublishedDefinitionFiles()
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
  // Why the whole route: a loader keeps its context, so the same path on another host needs its own.
  const ownerKey = JSON.stringify([
    source.root.rootKey,
    context.target,
    context.connectionId ?? null,
    context.expectedSshConnectionGeneration ?? null
  ])
  const existing = loadersByOwner.get(ownerKey)
  if (existing) {
    return existing
  }
  const loader = createDefinitionContextLoader(
    createRuntimeDefinitionFileHost(context, source.root),
    source.root,
    sink,
    publishedFiles
  )
  loadersByOwner.set(ownerKey, loader)
  return loader
}
