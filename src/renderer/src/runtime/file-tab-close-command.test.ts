// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../shared/tab-types'
import type { OpenFile } from '../store/slices/editor'

const closeWebRuntimeSessionTabMock = vi.fn(async (_args: unknown) => 'applied' as const)

vi.mock('./web-runtime-session-tab-lifecycle', () => ({
  closeWebRuntimeSessionTab: (args: unknown) => closeWebRuntimeSessionTabMock(args)
}))

import { useAppStore } from '../store'
import { closeFileTabsInStore } from './file-tab-close-command'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync/snapshot-api'
import {
  ENV,
  NOW,
  WT,
  makeSnapshot,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

const notesPath = '/repo/NOTES.md'
const clientDraft = '# unsaved client edits'

const notesUnifiedTab: Tab = {
  id: 'host-notes-unified',
  entityId: notesPath,
  groupId: 'host-group-1',
  worktreeId: WT,
  contentType: 'editor',
  label: 'NOTES.md',
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: NOW - 10,
  isPreview: false,
  isPinned: false
}

// A host-mirrored tab the user has edited on this client: dirty, with a draft recorded.
const clientDirtyMirroredNotes: OpenFile = {
  id: notesPath,
  filePath: notesPath,
  relativePath: 'NOTES.md',
  worktreeId: WT,
  language: 'markdown',
  isDirty: true,
  runtimeEnvironmentId: ENV,
  mode: 'edit',
  mirroredFromRuntimeSession: true
}

// The host republishes the same tab; its own store has no unsaved edits.
function hostCleanRepublish() {
  return makeSnapshot(
    [
      {
        type: 'markdown',
        id: notesUnifiedTab.id,
        title: 'NOTES.md',
        filePath: notesPath,
        relativePath: 'NOTES.md',
        language: 'markdown',
        mode: 'edit',
        isDirty: false,
        isActive: true,
        sourceFileId: notesPath,
        sourceFilePath: notesPath,
        sourceRelativePath: 'NOTES.md',
        documentVersion: `file:${notesPath}`,
        color: null,
        isPinned: false
      }
    ],
    { activeTabId: notesUnifiedTab.id, activeTabType: 'markdown' }
  )
}

describe('CLI file close uses the editor close transaction', () => {
  const initialState = useAppStore.getState()
  beforeEach(() => {
    resetWebSessionTabsSyncTestState()
    closeWebRuntimeSessionTabMock.mockClear()
    useAppStore.setState({
      ...initialState,
      activeWorktreeId: WT,
      openFiles: [{ ...clientDirtyMirroredNotes, isDirty: false }],
      editorDrafts: {},
      unifiedTabsByWorktree: { [WT]: [notesUnifiedTab] }
    })
  })
  afterEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('removes the file and unified tab, tells the host, and stays closed after a stale snapshot', async () => {
    closeFileTabsInStore(useAppStore.getState(), WT, [notesUnifiedTab.id], false)
    expect(useAppStore.getState().openFiles).toEqual([])
    expect(useAppStore.getState().unifiedTabsByWorktree[WT]).toEqual([])
    useAppStore.setState(
      applyWebSessionTabsSnapshot(useAppStore.getState(), hostCleanRepublish(), ENV, NOW)
    )
    expect(useAppStore.getState().openFiles).toEqual([])
    expect(useAppStore.getState().unifiedTabsByWorktree[WT]).toEqual([])
    await vi.waitFor(() =>
      expect(closeWebRuntimeSessionTabMock).toHaveBeenCalledWith({
        worktreeId: WT,
        tabId: notesUnifiedTab.id,
        environmentId: ENV,
        reason: 'user'
      })
    )
  })

  it.each([true, false])('refuses a dirty flag or an unflushed draft (%s)', (isDirty) => {
    useAppStore.setState({
      openFiles: [{ ...clientDirtyMirroredNotes, isDirty }],
      editorDrafts: isDirty ? {} : { [notesPath]: clientDraft }
    })
    expect(() =>
      closeFileTabsInStore(useAppStore.getState(), WT, [notesUnifiedTab.id], false)
    ).toThrow('Unsaved changes')
    expect(useAppStore.getState().openFiles).toHaveLength(1)
    expect(closeWebRuntimeSessionTabMock).not.toHaveBeenCalled()
  })

  it('only discards a draft with explicit force', () => {
    useAppStore.setState({
      openFiles: [clientDirtyMirroredNotes],
      editorDrafts: { [notesPath]: clientDraft }
    })
    closeFileTabsInStore(useAppStore.getState(), WT, [notesUnifiedTab.id], true)
    expect(useAppStore.getState().openFiles).toEqual([])
    expect(useAppStore.getState().editorDrafts).toEqual({})
  })

  it('refuses pinned files instead of opening a confirmation dialog', () => {
    useAppStore.setState({
      unifiedTabsByWorktree: { [WT]: [{ ...notesUnifiedTab, isPinned: true }] }
    })
    expect(() =>
      closeFileTabsInStore(useAppStore.getState(), WT, [notesUnifiedTab.id], false)
    ).toThrow('Pinned')
    expect(useAppStore.getState().openFiles).toHaveLength(1)
  })

  it('checks the whole batch before closing any file', () => {
    const second = {
      ...clientDirtyMirroredNotes,
      id: 'second',
      filePath: '/repo/second.md',
      relativePath: 'second.md'
    }
    useAppStore.setState({
      openFiles: [...useAppStore.getState().openFiles, second],
      unifiedTabsByWorktree: {
        [WT]: [notesUnifiedTab, { ...notesUnifiedTab, id: 'second-tab', entityId: 'second' }]
      }
    })
    expect(() =>
      closeFileTabsInStore(useAppStore.getState(), WT, [notesUnifiedTab.id, 'second-tab'], false)
    ).toThrow('Unsaved changes')
    expect(useAppStore.getState().openFiles).toHaveLength(2)
  })

  it('refuses a missing or foreign-workspace tab', () => {
    expect(() =>
      closeFileTabsInStore(useAppStore.getState(), 'other', [notesUnifiedTab.id], true)
    ).toThrow('File tab not found')
    expect(useAppStore.getState().openFiles).toHaveLength(1)
  })
})
