// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
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
import { useEditorContentChangeHandler } from './use-editor-content-change-handler'

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
})
