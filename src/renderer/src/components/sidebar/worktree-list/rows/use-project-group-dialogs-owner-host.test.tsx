// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectGroupDialogs, type ProjectGroupDialogs } from './use-project-group-dialogs'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'

const mocks = vi.hoisted(() => {
  const storedGroups: ProjectGroup[] = []
  return {
    moveProjectToGroup: vi.fn(),
    createProjectGroup: vi.fn(),
    updateProjectGroup: vi.fn(),
    deleteProjectGroupWithContainedProjects: vi.fn(),
    toastError: vi.fn(),
    storedGroups
  }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        moveProjectToGroup: mocks.moveProjectToGroup,
        createProjectGroup: mocks.createProjectGroup,
        updateProjectGroup: mocks.updateProjectGroup,
        deleteProjectGroupWithContainedProjects: mocks.deleteProjectGroupWithContainedProjects
      }),
    { getState: () => ({ projectGroups: mocks.storedGroups }) }
  )
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError }
}))

const remoteGroup: ProjectGroup = {
  id: 'group-1',
  name: 'Projects',
  parentPath: '/srv/projects',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  executionHostId: 'runtime:env-1',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

let latest: ProjectGroupDialogs | null = null
const roots: Root[] = []

function HookProbe(): null {
  latest = useProjectGroupDialogs({
    repos: [],
    repoMap: new Map(),
    projectGroups: [remoteGroup]
  })
  return null
}

async function renderHookProbe(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<HookProbe />)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.storedGroups = [remoteGroup]
  mocks.updateProjectGroup.mockResolvedValue(true)
  mocks.deleteProjectGroupWithContainedProjects.mockResolvedValue({
    status: 'deleted-group',
    groupId: remoteGroup.id,
    requestedProjectIds: [],
    removedProjectIds: [],
    failedProjectRemovals: []
  })
})

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  latest = null
})

describe('project group dialogs carry the owner host', () => {
  it('renames through the host that owns the group row', async () => {
    await renderHookProbe()
    await act(async () => {
      latest!.handleRenameProjectGroup(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSubmitProjectGroupName('Renamed')
    })

    expect(mocks.updateProjectGroup).toHaveBeenCalledWith(
      remoteGroup.id,
      { name: 'Renamed' },
      { hostId: 'runtime:env-1' }
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('surfaces an unconfirmed-rename toast when the owner host does not answer', async () => {
    mocks.updateProjectGroup.mockResolvedValue(false)
    await renderHookProbe()
    await act(async () => {
      latest!.handleRenameProjectGroup(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSubmitProjectGroupName('Renamed')
    })

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to rename group', {
      description:
        "Orca could not confirm the new name with the group's host. Recheck the group after reconnecting."
    })
  })

  it('deletes through the host that owns the group row', async () => {
    await renderHookProbe()
    await act(async () => {
      latest!.handleDeleteProjectGroup(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleConfirmDeleteProjectGroup()
    })

    expect(mocks.deleteProjectGroupWithContainedProjects).toHaveBeenCalledWith(remoteGroup.id, {
      removeContainedProjects: false,
      hostId: 'runtime:env-1'
    })
  })

  it('sets a group icon through the owner host without a toast when it is stored', async () => {
    mocks.updateProjectGroup.mockImplementation(async () => {
      mocks.storedGroups = [{ ...remoteGroup, icon: { type: 'emoji', emoji: '🌱' } }]
      return true
    })
    await renderHookProbe()
    await act(async () => {
      latest!.handleChangeProjectGroupIcon(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSetProjectGroupIcon({ type: 'emoji', emoji: '🌱' })
    })

    expect(mocks.updateProjectGroup).toHaveBeenCalledWith(
      remoteGroup.id,
      { icon: { type: 'emoji', emoji: '🌱' } },
      { hostId: 'runtime:env-1' }
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('tells the user when an older host accepts the save but drops the icon', async () => {
    await renderHookProbe()
    await act(async () => {
      latest!.handleChangeProjectGroupIcon(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSetProjectGroupIcon({ type: 'emoji', emoji: '🌱' })
    })

    expect(mocks.toastError).toHaveBeenCalledWith(
      "This group's host doesn't support group icons yet",
      expect.objectContaining({ description: expect.stringContaining('older version') })
    )
  })

  it('surfaces an unconfirmed-icon toast when the owner host does not answer', async () => {
    mocks.updateProjectGroup.mockResolvedValue(false)
    await renderHookProbe()
    await act(async () => {
      latest!.handleChangeProjectGroupIcon(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSetProjectGroupIcon(null)
    })

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to update group icon',
      expect.objectContaining({ description: expect.stringContaining('could not confirm') })
    )
  })

  it('reports a replacement the host did not store', async () => {
    mocks.storedGroups = [{ ...remoteGroup, icon: { type: 'emoji', emoji: '🌱' } }]
    await renderHookProbe()
    await act(async () => {
      latest!.handleChangeProjectGroupIcon(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSetProjectGroupIcon({ type: 'emoji', emoji: '🚀' })
    })

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to update group icon', expect.anything())
  })

  it('reports a clear the host did not apply, and accepts one it did', async () => {
    mocks.storedGroups = [{ ...remoteGroup, icon: { type: 'emoji', emoji: '🌱' } }]
    await renderHookProbe()
    await act(async () => {
      latest!.handleChangeProjectGroupIcon(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSetProjectGroupIcon(null)
    })
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to update group icon', expect.anything())

    mocks.toastError.mockClear()
    mocks.updateProjectGroup.mockImplementation(async () => {
      mocks.storedGroups = [remoteGroup]
      return true
    })
    await act(async () => {
      await latest!.handleSetProjectGroupIcon(null)
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('starts the next icon save only after the previous one answers', async () => {
    let answerFirst: (saved: boolean) => void = () => {}
    mocks.updateProjectGroup
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            answerFirst = resolve
          })
      )
      .mockResolvedValue(true)
    await renderHookProbe()
    await act(async () => {
      latest!.handleChangeProjectGroupIcon(remoteGroup.id, remoteGroup.name, 'runtime:env-1')
    })

    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    await act(async () => {
      first = latest!.handleSetProjectGroupIcon({ type: 'emoji', emoji: '🌱' })
      second = latest!.handleSetProjectGroupIcon({ type: 'emoji', emoji: '🚀' })
    })
    expect(mocks.updateProjectGroup).toHaveBeenCalledTimes(1)

    await act(async () => {
      answerFirst(true)
      await first
      await second
    })
    expect(mocks.updateProjectGroup).toHaveBeenCalledTimes(2)
    expect(mocks.updateProjectGroup).toHaveBeenLastCalledWith(
      remoteGroup.id,
      { icon: { type: 'emoji', emoji: '🚀' } },
      { hostId: 'runtime:env-1' }
    )
  })
})
