// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import { requestEditorFileSave } from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import {
  createEditorStore,
  createFakeEditorDisk,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'
import {
  useEditorContentChangeHandler,
  type EditorPanelEditHandlers
} from './use-editor-content-change-handler'

const mocks = vi.hoisted(() => {
  const store: { current: StoreApi<AppState> | null } = { current: null }
  return { store }
})
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))
vi.mock('@/store', () => {
  const useAppStore = <T,>(selector: (state: AppState) => T): T => {
    const state = mocks.store.current?.getState()
    if (!state) {
      throw new Error('store not set')
    }
    return selector(state)
  }
  useAppStore.getState = () => mocks.store.current?.getState()
  return { useAppStore }
})

const FILE_ID = '/repo/file.ts'

/** One panel whose cache shows `panelShows` while disk (and the shared baseline) hold `disk`. */
function setUp(disk: string, panelShows: string) {
  const fakeDisk: FakeEditorDisk = stubEditorWindowWithDisk(
    createFakeEditorDisk({ [FILE_ID]: disk })
  )
  const store = createEditorStore()
  mocks.store.current = store
  store.setState({ settings: null })
  store.getState().openFile({
    filePath: FILE_ID,
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  })
  store.getState().commitCleanDiskContent(FILE_ID, disk)
  const panel = renderHook(() =>
    useEditorContentChangeHandler({
      fileContents: { [FILE_ID]: { content: panelShows, isBinary: false } },
      diffContents: {}
    })
  )
  const file = () => store.getState().openFiles.find((openFile) => openFile.id === FILE_ID) ?? null
  const cleanupController = attachEditorAutosaveController(store)
  return { disk: fakeDisk, store, panel, file, cleanupController }
}

function renderPanel(panelShows: string) {
  return renderHook(() =>
    useEditorContentChangeHandler({
      fileContents: { [FILE_ID]: { content: panelShows, isBinary: false } },
      diffContents: {}
    })
  )
}

describe('saves from a panel showing older text than another panel loaded', () => {
  beforeEach(() => {
    __clearSelfWriteRegistryForTests()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    mocks.store.current = null
  })

  it('guards a typed edit against the text this panel showed', async () => {
    const { disk, panel, file, cleanupController } = setUp('B', 'A')
    try {
      panel.result.current.onContentChange(file(), 'A edited')

      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })

  it('guards an editor that reports dirty before its content (rich markdown, notebooks)', async () => {
    const { disk, panel, file, cleanupController } = setUp('B', 'A')
    try {
      panel.result.current.onDirtyHint(file(), true)
      panel.result.current.onContentChange(file(), 'A edited')

      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })

  it('writes nothing for Cmd+S in a clean panel showing older text', async () => {
    const { disk, cleanupController } = setUp('B', 'A')
    try {
      await requestEditorFileSave({
        fileId: FILE_ID,
        fallbackContent: 'A',
        confirmDiskOverwrite: true
      })

      expect(disk.fs.writeFile).not.toHaveBeenCalled()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })

  it('anchors a keystroke right after its own save to the written text, not the old load', async () => {
    // The panel's cached load (P) is replaced by the save's text (S) only on the next render.
    const { disk, panel, file, cleanupController } = setUp('P', 'P')
    try {
      panel.result.current.onContentChange(file(), 'S')
      await requestEditorFileSave({ fileId: FILE_ID })
      expect(disk.files.get(FILE_ID)).toBe('S')

      panel.result.current.onContentChange(file(), 'S and more')
      await requestEditorFileSave({ fileId: FILE_ID })

      expect(disk.files.get(FILE_ID)).toBe('S and more')
    } finally {
      cleanupController()
    }
  })

  it('keeps the base of a draft another panel left clean when this panel types into it', async () => {
    // Panel A shows stale A, panel B shows disk B. A edits then undoes, leaving draft "A" clean;
    // B now displays that draft, and B's keystroke must stay based on A, not on B's cache.
    const { disk, panel: panelA, file, cleanupController } = setUp('B', 'A')
    const panelB = renderPanel('B')
    try {
      panelA.result.current.onContentChange(file(), 'A x')
      panelA.result.current.onContentChange(file(), 'A')
      panelB.result.current.onContentChange(file(), 'A y')

      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })

  it('does the same when the first panel reported dirty, then clean, before its content', async () => {
    const { disk, panel: panelA, file, cleanupController } = setUp('B', 'A')
    const panelB = renderPanel('B')
    try {
      panelA.result.current.onDirtyHint(file(), true)
      panelA.result.current.onContentChange(file(), 'A x')
      panelA.result.current.onDirtyHint(file(), false)
      panelA.result.current.onContentChange(file(), 'A')
      panelB.result.current.onContentChange(file(), 'A y')

      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })

  it('saves normally when both panels showed the current disk text', async () => {
    const { disk, panel: panelA, file, cleanupController } = setUp('B', 'B')
    const panelB = renderPanel('B')
    try {
      panelA.result.current.onContentChange(file(), 'B x')
      panelA.result.current.onContentChange(file(), 'B')
      panelB.result.current.onContentChange(file(), 'B y')
      await requestEditorFileSave({ fileId: FILE_ID })

      expect(disk.files.get(FILE_ID)).toBe('B y')
    } finally {
      cleanupController()
    }
  })

  it('anchors a keystroke on the old model, before the editor swaps in a reload, to the old text', async () => {
    // The panel's cache moves A -> B; the editor (a child) swaps its model in its own effect, and a
    // keystroke can land on the old model first. It must not be paired with B.
    const { disk, file, cleanupController } = setUp('B', 'A')
    function Editor({ shows, handlers }: { shows: string; handlers: EditorPanelEditHandlers }) {
      useEffect(() => {
        if (shows === 'B') {
          handlers.onContentChange(file(), 'A typed')
        }
      }, [handlers, shows])
      return null
    }
    function Panel({ shows }: { shows: string }) {
      const handlers = useEditorContentChangeHandler({
        fileContents: { [FILE_ID]: { content: shows, isBinary: false } },
        diffContents: {}
      })
      return <Editor shows={shows} handlers={handlers} />
    }
    try {
      const view = render(<Panel shows="A" />)
      act(() => view.rerender(<Panel shows="B" />))

      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })

  it('saves a Markdown edit that only adds a final newline, though it does not mark dirty', async () => {
    const { disk, store, cleanupController } = setUp('text', 'text')
    const markdown = renderPanel('text')
    try {
      store.setState({
        openFiles: store
          .getState()
          .openFiles.map((openFile) => ({ ...openFile, language: 'markdown' }))
      })
      const tab = store.getState().openFiles.find((openFile) => openFile.id === FILE_ID) ?? null
      markdown.result.current.onContentChange(tab, 'text\n')
      expect(store.getState().openFiles[0]?.isDirty).toBe(false)

      await requestEditorFileSave({ fileId: FILE_ID })

      expect(disk.files.get(FILE_ID)).toBe('text\n')
    } finally {
      cleanupController()
    }
  })

  it('guards a clean Markdown draft from a stale panel against the text that panel showed', async () => {
    const { disk, store, panel, cleanupController } = setUp('B', 'A')
    try {
      store.setState({
        openFiles: store
          .getState()
          .openFiles.map((openFile) => ({ ...openFile, language: 'markdown' }))
      })
      const tab = store.getState().openFiles.find((openFile) => openFile.id === FILE_ID) ?? null
      panel.result.current.onContentChange(tab, 'A\n')

      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
    } finally {
      cleanupController()
    }
  })
})
