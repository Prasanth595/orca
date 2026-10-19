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
  stubEditorWindowWithDisk
} from './editor-autosave-controller-test-fixture'
import { getDiskBaselineSignature } from './diff-content-signature'
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

describe('an edit in a panel showing older content than the shared baseline', () => {
  beforeEach(() => {
    __clearSelfWriteRegistryForTests()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    mocks.store.current = null
  })

  it('is guarded against the content that panel showed, not a newer load elsewhere', async () => {
    const disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [FILE_ID]: 'B' }))
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
    // Another split panel reloaded and advanced the shared baseline to B.
    store.getState().commitCleanDiskContent(FILE_ID, 'B')
    // This panel still shows A from its own cache.
    const { result } = renderHook(() =>
      useEditorContentChangeHandler({
        fileContents: { [FILE_ID]: { content: 'A', isBinary: false } },
        diffContents: {}
      })
    )
    const file = store.getState().openFiles.find((openFile) => openFile.id === FILE_ID) ?? null
    result.current(file, 'A edited')

    const cleanupController = attachEditorAutosaveController(store)
    try {
      await expect(requestEditorFileSave({ fileId: FILE_ID })).rejects.toThrow()
      expect(disk.files.get(FILE_ID)).toBe('B')
      expect(
        store.getState().openFiles.find((openFile) => openFile.id === FILE_ID)
          ?.lastKnownDiskSignature
      ).toBe(getDiskBaselineSignature('A'))
    } finally {
      cleanupController()
    }
  })
})
