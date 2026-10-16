import { describe, expect, it } from 'vitest'
import { buildRows } from './build-rows'
import { mergeProjectGroupsAcrossHosts } from './cross-host-project-group-merge'
import { getProjectGroupHeaderKey } from './group-keys'
import type { Row } from './row-types'
import { worktree } from '../../worktree-list-groups-test-fixtures'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'

const RUNTIME_HOST = 'runtime:env-1' as const

function makeGroup(overrides: Partial<ProjectGroup> & Pick<ProjectGroup, 'id'>): ProjectGroup {
  return {
    name: 'ai',
    parentPath: '/Users/me/code/ai',
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

const localAi = makeGroup({ id: 'local-ai', executionHostId: 'local' })
const remoteAi = makeGroup({
  id: 'remote-ai',
  parentPath: '/home/me/code/ai',
  executionHostId: RUNTIME_HOST,
  tabOrder: 1
})
const remoteSkills = makeGroup({
  id: 'remote-skills',
  name: 'skills',
  parentPath: '/home/me/code/ai/skills',
  parentGroupId: 'remote-ai',
  executionHostId: RUNTIME_HOST,
  tabOrder: 2
})

const localRepo: Repo = {
  id: 'repo-local',
  path: '/Users/me/code/ai/orca',
  displayName: 'orca',
  badgeColor: '#000000',
  addedAt: 0,
  executionHostId: 'local',
  projectGroupId: localAi.id
}
const remoteRepo: Repo = {
  id: 'repo-remote',
  path: '/home/me/code/ai/trading',
  displayName: 'trading',
  badgeColor: '#111111',
  addedAt: 1,
  executionHostId: RUNTIME_HOST,
  projectGroupId: remoteAi.id
}
const remoteSkillRepo: Repo = {
  id: 'repo-remote-skill',
  path: '/home/me/code/ai/skills/vault',
  displayName: 'vault',
  badgeColor: '#222222',
  addedAt: 2,
  executionHostId: RUNTIME_HOST,
  projectGroupId: remoteSkills.id
}

function mainWorktree(repo: Repo): Worktree {
  return {
    ...worktree,
    id: `${repo.id}::main`,
    repoId: repo.id,
    hostId: repo.executionHostId ?? undefined,
    path: repo.path,
    branch: 'refs/heads/main',
    isMainWorktree: true,
    displayName: 'main'
  }
}

const remoteFolderWorkspace: FolderWorkspace = {
  id: 'folder-remote',
  projectGroupId: remoteAi.id,
  executionHostId: RUNTIME_HOST,
  name: 'Remote scratch',
  folderPath: '/home/me/code/ai/scratch',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

function buildCrossHostRows(options: {
  groups: readonly ProjectGroup[]
  repos: readonly Repo[]
  folderWorkspaces?: readonly FolderWorkspace[]
  collapsedGroups?: Set<string>
}): Row[] {
  const merge = mergeProjectGroupsAcrossHosts(options.groups, 'local')
  const worktrees = options.repos.map(mainWorktree)
  return buildRows(
    'repo',
    worktrees,
    new Map(options.repos.map((repo) => [repo.id, repo])),
    null,
    options.collapsedGroups ?? new Set<string>(),
    undefined,
    undefined,
    'manual',
    {},
    new Map(worktrees.map((row) => [row.id, row])),
    true,
    undefined,
    merge.displayGroups,
    new Set(),
    new Map(),
    new Map(),
    [],
    undefined,
    options.folderWorkspaces ?? [],
    undefined,
    'local',
    'single-location',
    [],
    merge
  )
}

function describeRows(rows: readonly Row[]): string[] {
  return rows.map((row) => {
    switch (row.type) {
      case 'header':
        return row.projectGroup
          ? `group:${row.label}@${row.projectGroupDepth ?? 0}#${row.count}`
          : `project:${row.label}@${row.projectGroupDepth ?? 0}`
      case 'item':
        return `item:${row.worktree.id}`
      case 'folder-workspace':
        return `folder:${row.folderWorkspace.id}@${row.groupDepth}`
      case 'imported-worktrees-card':
      case 'new-external-worktrees-inbox':
      case 'pending-creation':
        return row.type
    }
  })
}

describe('buildRows with same-named project groups on two hosts', () => {
  it("draws one header holding both hosts' projects and the remote folder workspace", () => {
    const rows = buildCrossHostRows({
      groups: [localAi, remoteAi],
      repos: [localRepo, remoteRepo],
      folderWorkspaces: [remoteFolderWorkspace]
    })

    expect(describeRows(rows)).toEqual([
      'group:ai@0#3',
      'folder:folder-remote@1',
      'project:orca@1',
      'item:repo-local::main',
      'project:trading@1',
      'item:repo-remote::main'
    ])
    const header = rows[0]
    expect(header.type === 'header' && header.key).toBe(getProjectGroupHeaderKey(localAi.id))
    const folderRow = rows[1]
    // Why: the folder workspace keeps its own host's group so its host and path status stay its own.
    expect(folderRow.type === 'folder-workspace' && folderRow.projectGroup).toBe(remoteAi)
  })

  it("collapses both hosts' rows under the single header key", () => {
    const rows = buildCrossHostRows({
      groups: [localAi, remoteAi],
      repos: [localRepo, remoteRepo],
      collapsedGroups: new Set([getProjectGroupHeaderKey(localAi.id)])
    })

    expect(describeRows(rows)).toEqual(['group:ai@0#2'])
  })

  it('nests a remote-only child group under the merged parent', () => {
    const rows = buildCrossHostRows({
      groups: [localAi, remoteAi, remoteSkills],
      repos: [localRepo, remoteRepo, remoteSkillRepo]
    })

    expect(describeRows(rows)).toEqual([
      'group:ai@0#3',
      'project:orca@1',
      'item:repo-local::main',
      'project:trading@1',
      'item:repo-remote::main',
      'group:skills@1#1',
      'project:vault@2',
      'item:repo-remote-skill::main'
    ])
  })

  it('keeps separate headers when the names differ', () => {
    const rows = buildCrossHostRows({
      groups: [localAi, { ...remoteAi, name: 'ai-server' }],
      repos: [localRepo, remoteRepo]
    })

    expect(describeRows(rows)).toEqual([
      'group:ai@0#1',
      'project:orca@1',
      'item:repo-local::main',
      'group:ai-server@0#1',
      'project:trading@1',
      'item:repo-remote::main'
    ])
  })
})
