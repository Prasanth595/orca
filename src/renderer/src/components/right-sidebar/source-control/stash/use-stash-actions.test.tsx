// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import type { SourceControlActionError } from '../sync/action-error'

const mocks = vi.hoisted(() => ({
  stash: vi.fn(),
  list: vi.fn(),
  confirm: vi.fn(),
  quiesce: vi.fn(),
  notify: vi.fn(),
  begin: vi.fn(),
  end: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  remoteActive: false
}))
vi.mock('@/runtime/runtime-git-stash-client', () => ({
  stashRuntimeGit: mocks.stash,
  listRuntimeGitStashes: mocks.list
}))
vi.mock('@/components/editor/editor-autosave', () => ({
  requestEditorSaveQuiesce: mocks.quiesce,
  notifyEditorExternalFileChange: mocks.notify
}))
vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => mocks.confirm
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error, info: mocks.info }
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      isRemoteOperationActive: mocks.remoteActive,
      beginRemoteOperation: mocks.begin,
      endRemoteOperation: mocks.end
    })
  }
}))

import { useSourceControlStashActions } from './use-stash-actions'

const selected = { ref: 'stash@{0}', oid: 'a'.repeat(40), subject: 'saved work' }
function foundation() {
  return {
    activeRepoTarget: { kind: 'environment', environmentId: 'owner' } as const,
    activeWorktreeId: 'wt-1',
    activeConnectionId: null,
    worktreePath: '/remote/repo',
    grouped: { staged: [], unstaged: [], untracked: [] },
    isCommitting: false,
    isAbortingOperation: false,
    unresolvedConflicts: [],
    setRemoteActionErrors:
      vi.fn<Dispatch<SetStateAction<Record<string, SourceControlActionError | null>>>>(),
    refreshActiveGitStatusAfterMutation: vi.fn(async () => {}),
    refreshBranchCompareRef: { current: vi.fn(async () => {}) },
    refreshGitHistoryRef: { current: vi.fn(async () => {}) }
  } satisfies Parameters<typeof useSourceControlStashActions>[0]
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.remoteActive = false
  mocks.begin.mockImplementation(() => {
    mocks.remoteActive = true
  })
  mocks.end.mockImplementation(() => {
    mocks.remoteActive = false
  })
  mocks.stash.mockResolvedValue({ output: 'saved work' })
  mocks.list.mockResolvedValue({ entries: [selected], truncated: false })
  mocks.quiesce.mockResolvedValue(undefined)
})

describe('Source Control stash actions', () => {
  it('awaits editor quiescence, prevents duplicate mutations, and refreshes after saving', async () => {
    const inputs = foundation()
    const { result } = renderHook(() => useSourceControlStashActions(inputs))
    await act(async () => {
      await result.current.requestStashAction('push_untracked')
    })
    let release = () => {}
    mocks.quiesce.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.saveStash('message')
    })
    expect(result.current.busy).toBe(true)
    expect(mocks.stash).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.saveStash('duplicate')
      release()
      await pending
    })
    expect(mocks.stash).toHaveBeenCalledTimes(1)
    expect(mocks.stash).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'environment', environmentId: 'owner' },
        worktreeId: 'wt-1'
      }),
      { action: 'push_untracked', message: 'message' }
    )
    expect(mocks.notify).toHaveBeenCalled()
    expect(inputs.refreshActiveGitStatusAfterMutation).toHaveBeenCalled()
    expect(result.current.save).toBeNull()
  })
  it('pins Apply Last Stash to the entry read from the owner host', async () => {
    const inputs = foundation()
    const { result } = renderHook(() => useSourceControlStashActions(inputs))
    await act(async () => {
      await result.current.requestStashAction('apply_last')
    })
    expect(mocks.stash).toHaveBeenCalledWith(expect.anything(), {
      action: 'apply',
      stash: selected
    })
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  it('does not mutate when a Drop confirmation is cancelled', async () => {
    const inputs = foundation()
    const { result } = renderHook(() => useSourceControlStashActions(inputs))
    await act(async () => {
      await result.current.requestStashAction('drop')
    })
    mocks.confirm.mockResolvedValue(false)
    await act(async () => {
      await result.current.selectStash(selected)
    })
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmVariant: 'destructive' })
    )
    expect(mocks.stash).not.toHaveBeenCalled()
  })
  it('clears only the stash list confirmed by the user', async () => {
    const inputs = foundation()
    const { result } = renderHook(() => useSourceControlStashActions(inputs))
    mocks.confirm.mockResolvedValue(true)
    await act(async () => {
      await result.current.requestStashAction('clear')
    })
    expect(mocks.stash).toHaveBeenCalledWith(expect.anything(), {
      action: 'clear',
      expectedStashes: [selected.oid]
    })
    expect(mocks.quiesce).not.toHaveBeenCalled()
  })
  it('refreshes conflicted files and retains a persistent error when Pop fails', async () => {
    const inputs = foundation()
    const { result } = renderHook(() => useSourceControlStashActions(inputs))
    mocks.stash.mockRejectedValue(new Error('CONFLICT: retained stash'))
    await act(async () => {
      await result.current.requestStashAction('pop_last')
    })
    expect(mocks.error).toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalled()
    expect(inputs.setRemoteActionErrors).toHaveBeenCalledTimes(2)
    expect(inputs.refreshActiveGitStatusAfterMutation).toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
  })
  it('ignores a stash list response after switching workspaces', async () => {
    const inputs = foundation()
    let release = (_result: { entries: (typeof selected)[]; truncated: boolean }) => {}
    mocks.list.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const { result, rerender } = renderHook((props) => useSourceControlStashActions(props), {
      initialProps: inputs
    })
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.requestStashAction('show')
    })
    rerender({ ...inputs, activeWorktreeId: 'wt-2' })
    await act(async () => {
      release({ entries: [selected], truncated: false })
      await pending
    })
    expect(result.current.picker).toBeNull()
    expect(mocks.stash).not.toHaveBeenCalled()
  })
  it('views the selected stash without modifying files or quiescing editor writes', async () => {
    const inputs = foundation()
    const { result } = renderHook(() => useSourceControlStashActions(inputs))
    await act(async () => {
      await result.current.requestStashAction('show')
    })
    await act(async () => {
      await result.current.selectStash(selected)
    })
    expect(result.current.view?.stash).toEqual(selected)
    expect(mocks.quiesce).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(inputs.refreshActiveGitStatusAfterMutation).not.toHaveBeenCalled()
  })
})
