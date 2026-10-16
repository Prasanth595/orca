// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectGroupDialogs, type ProjectGroupDialogs } from './use-project-group-dialogs'
import { mergeProjectGroupsAcrossHosts } from '../grouping/cross-host-project-group-merge'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'

const mocks = vi.hoisted(() => ({
  moveProjectToGroup: vi.fn(),
  createProjectGroup: vi.fn(),
  updateProjectGroup: vi.fn(),
  deleteProjectGroupWithContainedProjects: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      moveProjectToGroup: mocks.moveProjectToGroup,
      createProjectGroup: mocks.createProjectGroup,
      updateProjectGroup: mocks.updateProjectGroup,
      deleteProjectGroupWithContainedProjects: mocks.deleteProjectGroupWithContainedProjects
    })
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError }
}))

const localGroup: ProjectGroup = {
  id: 'group-local',
  name: 'ai',
  parentPath: '/Users/me/code/ai',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  executionHostId: 'local',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}
const remoteGroup: ProjectGroup = {
  ...localGroup,
  id: 'group-remote',
  parentPath: '/home/me/code/ai',
  executionHostId: 'runtime:env-1',
  tabOrder: 1
}
const localRepo: Repo = {
  id: 'repo-local',
  path: '/Users/me/code/ai/orca',
  displayName: 'orca',
  badgeColor: '#000',
  addedAt: 0,
  executionHostId: 'local',
  projectGroupId: localGroup.id
}
const remoteRepo: Repo = {
  id: 'repo-remote',
  path: '/home/me/code/ai/trading',
  displayName: 'trading',
  badgeColor: '#111',
  addedAt: 1,
  executionHostId: 'runtime:env-1',
  projectGroupId: remoteGroup.id
}
const repos = [localRepo, remoteRepo]
const projectGroups = [localGroup, remoteGroup]
const projectGroupMerge = mergeProjectGroupsAcrossHosts(projectGroups, 'local')

let latest: ProjectGroupDialogs | null = null
const roots: Root[] = []

function HookProbe({ probeRepos }: { probeRepos: readonly Repo[] }): null {
  latest = useProjectGroupDialogs({
    repos: probeRepos,
    projectGroups,
    projectGroupMerge
  })
  return null
}

async function renderHookProbe(probeRepos: readonly Repo[] = repos): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<HookProbe probeRepos={probeRepos} />)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateProjectGroup.mockResolvedValue(true)
  mocks.deleteProjectGroupWithContainedProjects.mockImplementation(async (groupId: string) => ({
    status: 'deleted-group',
    groupId,
    requestedProjectIds: [],
    removedProjectIds: [],
    failedProjectRemovals: []
  }))
})

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  latest = null
})

describe('project group dialogs on a header merged across hosts', () => {
  it('renames every member on its own host', async () => {
    await renderHookProbe()
    await act(async () => {
      latest!.handleRenameProjectGroup(localGroup.id, localGroup.name, 'local')
    })
    await act(async () => {
      await latest!.handleSubmitProjectGroupName('agents')
    })

    expect(mocks.updateProjectGroup).toHaveBeenCalledTimes(2)
    expect(mocks.updateProjectGroup).toHaveBeenCalledWith(
      localGroup.id,
      { name: 'agents' },
      { hostId: 'local' }
    )
    expect(mocks.updateProjectGroup).toHaveBeenCalledWith(
      remoteGroup.id,
      { name: 'agents' },
      { hostId: 'runtime:env-1' }
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('reports a rename that one host did not confirm', async () => {
    mocks.updateProjectGroup.mockImplementation(
      async (groupId: string) => groupId === localGroup.id
    )
    await renderHookProbe()
    await act(async () => {
      latest!.handleRenameProjectGroup(localGroup.id, localGroup.name, 'local')
    })
    await act(async () => {
      await latest!.handleSubmitProjectGroupName('agents')
    })

    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it("lists both hosts' projects and deletes every member", async () => {
    await renderHookProbe()
    await act(async () => {
      latest!.handleDeleteProjectGroup(localGroup.id, localGroup.name, 'local')
    })

    expect(latest!.deleteProjectNames).toEqual(['orca', 'trading'])

    await act(async () => {
      await latest!.handleConfirmDeleteProjectGroup()
    })

    expect(mocks.deleteProjectGroupWithContainedProjects).toHaveBeenCalledTimes(2)
    expect(mocks.deleteProjectGroupWithContainedProjects).toHaveBeenCalledWith(localGroup.id, {
      removeContainedProjects: false,
      hostId: 'local'
    })
    expect(mocks.deleteProjectGroupWithContainedProjects).toHaveBeenCalledWith(remoteGroup.id, {
      removeContainedProjects: false,
      hostId: 'runtime:env-1'
    })
  })

  it('counts a repo id that both hosts carry once per host', async () => {
    const sharedLocal: Repo = {
      ...localRepo,
      id: 'repo-shared',
      path: '/Users/me/code/ai/tiller',
      displayName: 'tiller'
    }
    const sharedRemote: Repo = {
      ...remoteRepo,
      id: 'repo-shared',
      path: '/home/me/code/ai/tiller',
      displayName: 'tiller (server)'
    }
    await renderHookProbe([localRepo, remoteRepo, sharedLocal, sharedRemote])
    await act(async () => {
      latest!.handleDeleteProjectGroup(localGroup.id, localGroup.name, 'local')
    })

    expect(latest!.deleteProjectCount).toBe(4)
    expect(latest!.deleteProjectNames).toEqual(['orca', 'tiller', 'trading', 'tiller (server)'])
  })

  it('leaves an unmerged header on its single owner host', async () => {
    await renderHookProbe()
    await act(async () => {
      latest!.handleRenameProjectGroup('group-other', 'other', 'runtime:env-1')
    })
    await act(async () => {
      await latest!.handleSubmitProjectGroupName('renamed')
    })

    expect(mocks.updateProjectGroup).toHaveBeenCalledTimes(1)
    expect(mocks.updateProjectGroup).toHaveBeenCalledWith(
      'group-other',
      { name: 'renamed' },
      { hostId: 'runtime:env-1' }
    )
  })
})
