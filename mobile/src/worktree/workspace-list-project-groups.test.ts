import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UNGROUPED_PROJECT_GROUP_KEY } from '../../../src/shared/project-groups'
import { DEFAULT_MOBILE_WORKSPACE_STATUSES } from './mobile-workspace-statuses'
import {
  buildRepoGroupingById,
  getMobileProjectGroupSectionKey,
  type MobileProjectGroup
} from './workspace-list-project-groups'
import { buildSections, type Worktree } from './workspace-list-sections'

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  const worktreePath = join('/tmp', 'orca', 'worktrees', overrides.worktreeId ?? 'feature')
  return {
    workspaceKind: 'git',
    worktreeId: `repo-1::${worktreePath}`,
    repoId: 'repo-1',
    repo: 'orca',
    branch: 'feature/mobile-parity',
    displayName: 'feature',
    path: worktreePath,
    liveTerminalCount: 0,
    hasAttachedPty: false,
    preview: '',
    unread: false,
    isPinned: false,
    linkedPR: null,
    status: 'inactive',
    agents: [],
    ...overrides
  }
}

const groups: MobileProjectGroup[] = [
  { id: 'client', name: 'Client A', parentGroupId: null, tabOrder: 1 },
  { id: 'nested', name: 'Nested', parentGroupId: 'client', tabOrder: 0 },
  { id: 'product', name: 'Product B', parentGroupId: null, tabOrder: 0 }
]

const grouping = buildRepoGroupingById([
  { id: 'repo-alpha', projectGroupId: 'client', projectGroupOrder: 1 },
  { id: 'repo-beta', projectGroupId: 'client', projectGroupOrder: 0 },
  { id: 'repo-nested', projectGroupId: 'nested', projectGroupOrder: 0 },
  { id: 'repo-orphan', projectGroupId: null, projectGroupOrder: 0 },
  { id: 'repo-missing-group', projectGroupId: 'gone', projectGroupOrder: 0 }
])

const worktrees = [
  worktree({
    worktreeId: 'alpha',
    repoId: 'repo-alpha',
    repo: 'Alpha',
    displayName: 'alpha'
  }),
  worktree({
    worktreeId: 'beta',
    repoId: 'repo-beta',
    repo: 'Beta',
    displayName: 'beta'
  }),
  worktree({
    worktreeId: 'nested-wt',
    repoId: 'repo-nested',
    repo: 'Nested Repo',
    displayName: 'nested-wt'
  }),
  worktree({
    worktreeId: 'orphan',
    repoId: 'repo-orphan',
    repo: 'Orphan',
    displayName: 'orphan'
  }),
  worktree({
    worktreeId: 'missing',
    repoId: 'repo-missing-group',
    repo: 'Missing',
    displayName: 'missing'
  })
]

function build(collapsed: ReadonlySet<string> = new Set()) {
  return buildSections(
    worktrees,
    'manual',
    { filterRepoIds: new Set(), hideSleeping: false, hideDefaultBranch: false },
    '',
    'projectGroup',
    new Set(),
    new Map([
      ['Alpha', 'repo-alpha'],
      ['Beta', 'repo-beta'],
      ['Nested Repo', 'repo-nested'],
      ['Orphan', 'repo-orphan'],
      ['Missing', 'repo-missing-group'],
      ['Empty', 'repo-empty']
    ]),
    DEFAULT_MOBILE_WORKSPACE_STATUSES,
    collapsed,
    groups,
    grouping
  )
}

describe('project group section keys', () => {
  it('uses the desktop collapsedGroups key so phone and desktop agree', () => {
    expect(getMobileProjectGroupSectionKey('client')).toBe('project-group:client')
    expect(getMobileProjectGroupSectionKey(null)).toBe(UNGROUPED_PROJECT_GROUP_KEY)
    expect(UNGROUPED_PROJECT_GROUP_KEY).toBe('project-group:ungrouped')
  })
})

describe('buildSections projectGroup mode', () => {
  it('emits group sections, nested indent, and a trailing ungrouped section', () => {
    const sections = build()
    expect(
      sections.map((section) => ({
        key: section.key,
        title: section.title,
        depth: section.depth ?? 0,
        count: section.count,
        worktrees: section.data.map((item) => item.worktreeId)
      }))
    ).toEqual([
      { key: 'project-group:product', title: 'Product B', depth: 0, count: 0, worktrees: [] },
      {
        key: 'project-group:client',
        title: 'Client A',
        depth: 0,
        count: 3,
        worktrees: []
      },
      { key: 'repo:repo-beta', title: 'Beta', depth: 1, count: undefined, worktrees: ['beta'] },
      { key: 'repo:repo-alpha', title: 'Alpha', depth: 1, count: undefined, worktrees: ['alpha'] },
      { key: 'project-group:nested', title: 'Nested', depth: 1, count: 1, worktrees: [] },
      {
        key: 'repo:repo-nested',
        title: 'Nested Repo',
        depth: 2,
        count: undefined,
        worktrees: ['nested-wt']
      },
      {
        key: 'project-group:ungrouped',
        title: 'Ungrouped',
        depth: 0,
        count: 3,
        worktrees: []
      },
      {
        key: 'repo:repo-missing-group',
        title: 'Missing',
        depth: 1,
        count: undefined,
        worktrees: ['missing']
      },
      {
        key: 'repo:repo-orphan',
        title: 'Orphan',
        depth: 1,
        count: undefined,
        worktrees: ['orphan']
      },
      { key: 'repo:repo-empty', title: 'Empty', depth: 1, count: undefined, worktrees: [] }
    ])
  })

  it('hides repos and nested groups when a project group is collapsed', () => {
    const sections = build(new Set(['project-group:client']))
    expect(sections.map((section) => section.key)).toEqual([
      'project-group:product',
      'project-group:client',
      'project-group:ungrouped',
      'repo:repo-missing-group',
      'repo:repo-orphan',
      'repo:repo-empty'
    ])
    expect(sections.find((section) => section.key === 'project-group:client')?.count).toBe(3)
  })

  it('collapses the trailing ungrouped section with the desktop ungrouped key', () => {
    const sections = build(new Set([UNGROUPED_PROJECT_GROUP_KEY]))
    expect(sections.map((section) => section.key)).toEqual([
      'project-group:product',
      'project-group:client',
      'repo:repo-beta',
      'repo:repo-alpha',
      'project-group:nested',
      'repo:repo-nested',
      'project-group:ungrouped'
    ])
  })
})
