import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_STATUSES } from '../../../src/shared/workspace-statuses'
import { NO_WORKSPACE_ROW_FILTERS } from '../../../src/shared/workspace-view/workspace-row-filters'
import { NO_PROJECT_SECTION_CATALOG, buildSections, type Worktree } from './workspace-list-sections'

function worktree(overrides: Partial<Worktree>): Worktree {
  return {
    workspaceKind: 'git',
    worktreeId: 'repo-1::/repos/repo-1',
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature',
    displayName: 'feature',
    path: '/repos/repo-1',
    liveTerminalCount: 0,
    hasAttachedPty: false,
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'inactive',
    agents: [],
    ...overrides
  }
}

describe('buildSections under Project Groups', () => {
  const catalog = {
    ...NO_PROJECT_SECTION_CATALOG,
    repos: [
      { id: 'repo-1', displayName: 'orca', path: '/repos/repo-1', projectGroupId: 'group-1' },
      { id: 'repo-2', displayName: 'docs', path: '/repos/repo-2' }
    ],
    projectGroups: [{ id: 'group-1', name: 'Work', parentGroupId: null, tabOrder: 0 }]
  }
  const grouped = worktree({})
  const ungrouped = worktree({
    worktreeId: 'repo-2::/repos/repo-2',
    repoId: 'repo-2',
    repo: 'docs',
    path: '/repos/repo-2'
  })
  const folder = worktree({
    workspaceKind: 'folder-workspace',
    worktreeId: 'folder:workspace-1',
    repoId: 'folder-workspace:group-1',
    repo: 'Work',
    branch: '',
    path: '/work/notes'
  })

  function build(search = '', collapsed = new Set<string>()) {
    return buildSections(
      [grouped, ungrouped, folder],
      'manual',
      { ...NO_WORKSPACE_ROW_FILTERS },
      search,
      'repo',
      new Set(),
      catalog,
      DEFAULT_WORKSPACE_STATUSES,
      collapsed
    ).map((section) => ({
      key: section.key,
      depth: section.depth ?? 0,
      count: section.count,
      rows: section.data.map((row) => row.worktreeId)
    }))
  }

  it('heads its projects and folder workspaces with the group, ahead of ungrouped projects', () => {
    expect(build()).toEqual([
      { key: 'project-group:group-1', depth: 0, count: 2, rows: [folder.worktreeId] },
      { key: 'repo:repo-1', depth: 1, count: undefined, rows: [grouped.worktreeId] },
      { key: 'repo:repo-2', depth: 0, count: undefined, rows: [ungrouped.worktreeId] }
    ])
  })

  it('drops the sections a collapsed group holds but keeps its header', () => {
    expect(build('', new Set(['project-group:group-1'])).map((section) => section.key)).toEqual([
      'project-group:group-1',
      'repo:repo-2'
    ])
  })

  it('drops a group with nothing matching the search', () => {
    expect(build('docs').map((section) => section.key)).toEqual(['repo:repo-2'])
  })

  it('lists a project once, and visibly, when two hosts hold a group with the same id', () => {
    // Host A nests its group-1 under Clients; host B keeps its group-1 at the root.
    const sharedId = {
      ...catalog,
      projectGroups: [
        { id: 'clients', name: 'Clients', parentGroupId: null, tabOrder: 0 },
        { id: 'group-1', name: 'Work', parentGroupId: 'clients', tabOrder: 0 },
        { id: 'group-1', name: 'Work', parentGroupId: null, tabOrder: 1 }
      ]
    }
    const keys = (collapsed: Set<string>) =>
      buildSections(
        [grouped],
        'manual',
        { ...NO_WORKSPACE_ROW_FILTERS },
        '',
        'repo',
        new Set(),
        sharedId,
        DEFAULT_WORKSPACE_STATUSES,
        collapsed
      ).map((section) => section.key)

    expect(keys(new Set()).filter((key) => key === 'repo:repo-1')).toHaveLength(1)
    expect(
      keys(new Set(['project-group:clients'])).filter((key) => key === 'repo:repo-1')
    ).toHaveLength(1)
  })
})
