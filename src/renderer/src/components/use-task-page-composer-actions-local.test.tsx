// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTaskPageComposerActions } from './use-task-page-composer-actions'
import type { LocalTask } from '../../../shared/local-task'

const openModal = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) }
}))

const TASK: LocalTask = {
  id: 7,
  url: 'orca://local-task/v1/project-1/7',
  title: 'Ship local board',
  description: '',
  status: 'todo',
  createdAt: 1,
  updatedAt: 1
}

const LOCAL_CONTEXT = {
  kind: 'task-source',
  provider: 'local',
  projectId: 'project-1',
  hostId: 'local',
  projectHostSetupId: null,
  repoId: null,
  providerIdentity: null,
  accountLabel: null
} as const

function setup(context: typeof LOCAL_CONTEXT | null) {
  openModal.mockClear()
  const model = {
    setTaskResumeState: vi.fn(),
    openModal,
    updateSettings: vi.fn(),
    selectLinearWorkspace: vi.fn(),
    listLinearTeams: vi.fn(),
    checkLinearConnection: vi.fn(),
    selectedLinearWorkspaceId: null,
    jiraSites: [],
    taskSource: 'local',
    linearTaskSourceContext: null,
    jiraTaskSourceContext: null,
    localTaskSourceContext: context,
    repos: [
      { id: 'repo-1', path: '/r1', name: 'r1', executionHostId: 'local' },
      { id: 'repo-2', path: '/r2', name: 'r2', executionHostId: 'local' }
    ],
    activeRepoId: 'repo-1'
  }
  const { result } = renderHook(() => useTaskPageComposerActions(model as never))
  return result
}

describe('useTaskPageComposerActions local', () => {
  it('opens the composer prefilled with the local task and its context', () => {
    const result = setup({ ...LOCAL_CONTEXT })
    act(() => {
      result.current.handleUseLocalTask(TASK)
    })
    expect(openModal).toHaveBeenCalledWith(
      'new-workspace-composer',
      expect.objectContaining({
        taskSourceContext: expect.objectContaining({ provider: 'local' }),
        prefilledName: expect.stringContaining('ship-local-board'),
        initialRepoId: 'repo-1'
      })
    )
    const linkedWorkItem = openModal.mock.calls[0][1].linkedWorkItem
    expect(linkedWorkItem).toEqual(
      expect.objectContaining({ provider: 'local', type: 'issue', number: 7 })
    )
  })

  it('refuses instead of creating unlinked when the local context is unavailable', () => {
    const result = setup(null)
    act(() => {
      result.current.handleUseLocalTask(TASK)
    })
    expect(openModal).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })
})
