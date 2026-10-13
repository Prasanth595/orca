import { describe, expect, it } from 'vitest'
import {
  addPinnedWorkspaceIds,
  excludeHiddenGroupWorktrees,
  filterActiveOnlyFolderWorkspaces,
  filterProjectGroupsWithVisibleWork,
  getActiveOnlyWorkspaceIds,
  getActiveViewGroupKey,
  getActiveViewHiddenGroups,
  getUnifiedTabWorktreeIds
} from './active-only-sidebar-scope'
import { computeVisibleWorktreeIds } from './visible-worktrees'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

const RUNTIME: ExecutionHostId = 'runtime:env-1'

function makeWorktree(id: string, repoId: string, isMainWorktree = false): Worktree {
  return {
    id,
    repoId,
    path: `/tmp/${id}`,
    head: 'abc123',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree,
    displayName: id,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

function makeGroup(
  id: string,
  parentGroupId: string | null = null,
  executionHostId?: ExecutionHostId
): ProjectGroup {
  return {
    id,
    executionHostId,
    name: id,
    parentPath: null,
    parentGroupId,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function makeFolderWorkspace(
  id: string,
  projectGroupId: string,
  executionHostId?: ExecutionHostId
): FolderWorkspace {
  return {
    id,
    executionHostId,
    projectGroupId,
    name: id,
    folderPath: `/tmp/${id}`,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0,
    updatedAt: 0
  }
}

function makeRepo(id: string, projectGroupId?: string, executionHostId?: ExecutionHostId): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 0,
    projectGroupId,
    executionHostId
  }
}

type VisibleOptions = Parameters<typeof computeVisibleWorktreeIds>[2]

function visibleOptions(overrides: Partial<VisibleOptions>): VisibleOptions {
  return {
    filterRepoIds: [],
    showSleepingWorkspaces: true,
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    worktreeIdsWithLiveAgent: new Set(),
    hideDefaultBranchWorkspace: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    hideDetachedHeadWorkspaces: false,
    hideWorkspacesFromOtherDevices: false,
    pairedDeviceIdsByEnvironment: new Map(),
    repoMap: new Map([['repo1', makeRepo('repo1')]]),
    workspaceHostScope: 'all',
    defaultHostId: LOCAL_EXECUTION_HOST_ID,
    worktreeLineageById: {},
    ...overrides
  }
}

// Same group id on the local catalog and on a paired runtime host.
const localOrch = makeGroup('orch')
const runtimeOrch = makeGroup('orch', null, RUNTIME)

describe('getActiveOnlyWorkspaceIds', () => {
  it('counts any open tab kind and live agents, and skips empty buckets', () => {
    const ids = getActiveOnlyWorkspaceIds({
      unifiedTabWorktreeIds: getUnifiedTabWorktreeIds({ editor: [{}], empty: [] }),
      tabsByWorktree: { terminal: [{}] },
      browserTabsByWorktree: { browser: [{}] },
      worktreeIdsWithLiveAgent: new Set(['agent'])
    })
    expect([...ids].sort()).toEqual(['agent', 'browser', 'editor', 'terminal'])
  })

  it('reuses the id list for an unchanged tab snapshot', () => {
    const snapshot = { a: [{}] }
    expect(getUnifiedTabWorktreeIds(snapshot)).toBe(getUnifiedTabWorktreeIds(snapshot))
  })
})

describe('computeVisibleWorktreeIds with activeOnlyWorkspaceIds', () => {
  it('keeps only listed workspaces and does not exempt the main worktree', () => {
    const main = makeWorktree('main', 'repo1', true)
    const open = makeWorktree('open', 'repo1')
    const idle = makeWorktree('idle', 'repo1')
    expect(
      computeVisibleWorktreeIds(
        { repo1: [main, open, idle] },
        ['main', 'open', 'idle'],
        visibleOptions({ activeOnlyWorkspaceIds: new Set(['open']) })
      )
    ).toEqual(['open'])
  })

  it('keeps editor-only workspaces when Hide sleeping is also on', () => {
    const editorOnly = makeWorktree('editor-only', 'repo1')
    expect(
      computeVisibleWorktreeIds(
        { repo1: [editorOnly] },
        ['editor-only'],
        visibleOptions({
          showSleepingWorkspaces: false,
          activeOnlyWorkspaceIds: new Set(['editor-only'])
        })
      )
    ).toEqual(['editor-only'])
  })
})

describe('addPinnedWorkspaceIds', () => {
  it('adds pinned worktrees even without open tabs', () => {
    const ids = new Set<string>()
    addPinnedWorkspaceIds(ids, {
      repo1: [{ ...makeWorktree('pinned', 'repo1'), isPinned: true }, makeWorktree('idle', 'repo1')]
    })
    expect([...ids]).toEqual(['pinned'])
  })
})

describe('Always mark inactive groups', () => {
  it('hides marked groups and nested groups on the same host only', () => {
    const hidden = getActiveViewHiddenGroups(
      [localOrch, makeGroup('sub', 'orch'), runtimeOrch, makeGroup('rsub', 'orch', RUNTIME)],
      [getActiveViewGroupKey(localOrch)]
    )
    expect([...hidden.entries()].sort()).toEqual([
      ['orch', [LOCAL_EXECUTION_HOST_ID]],
      ['sub', [LOCAL_EXECUTION_HOST_ID]]
    ])
  })

  it('drops hidden-group worktrees except kept and pinned ones, and spares the same id on another host', () => {
    const hidden = getActiveViewHiddenGroups(
      [localOrch, runtimeOrch],
      [getActiveViewGroupKey(localOrch)]
    )
    const repoMap = new Map([
      ['localRepo', makeRepo('localRepo', 'orch')],
      ['runtimeRepo', makeRepo('runtimeRepo', 'orch', RUNTIME)]
    ])
    const worktrees = [
      makeWorktree('lineage-parent', 'localRepo'),
      makeWorktree('current', 'localRepo'),
      { ...makeWorktree('pinned', 'localRepo'), isPinned: true },
      makeWorktree('runtime-open', 'runtimeRepo')
    ]
    expect(
      excludeHiddenGroupWorktrees(worktrees, hidden, repoMap, new Set(['current'])).map(
        (worktree) => worktree.id
      )
    ).toEqual(['current', 'pinned', 'runtime-open'])
  })

  it('treats SSH repos in a local group as members of that group', () => {
    const hidden = getActiveViewHiddenGroups([localOrch], [getActiveViewGroupKey(localOrch)])
    const sshRepo: Repo = { ...makeRepo('sshRepo', 'orch'), connectionId: 'box' }
    expect(
      excludeHiddenGroupWorktrees(
        [makeWorktree('ssh-wt', 'sshRepo')],
        hidden,
        new Map([['sshRepo', sshRepo]]),
        new Set()
      )
    ).toEqual([])
  })
})

describe('filterActiveOnlyFolderWorkspaces', () => {
  it('keeps open, current and pinned folder workspaces, minus hidden groups', () => {
    const hidden = getActiveViewHiddenGroups(
      [localOrch, runtimeOrch],
      [getActiveViewGroupKey(localOrch)]
    )
    const open = makeFolderWorkspace('open', 'other')
    const current = makeFolderWorkspace('current', 'orch')
    const pinned = { ...makeFolderWorkspace('pinned', 'orch'), isPinned: true }
    const hiddenOpen = makeFolderWorkspace('hidden-open', 'orch')
    const runtimeOpen = makeFolderWorkspace('runtime-open', 'orch', RUNTIME)
    const idle = makeFolderWorkspace('idle', 'other')
    expect(
      filterActiveOnlyFolderWorkspaces(
        [open, current, pinned, hiddenOpen, runtimeOpen, idle],
        new Set(['open', 'hidden-open', 'runtime-open'].map(folderWorkspaceKey)),
        folderWorkspaceKey('current'),
        hidden
      )
    ).toEqual([open, current, pinned, runtimeOpen])
  })
})

describe('filterProjectGroupsWithVisibleWork', () => {
  it('drops empty groups and keeps ancestors of groups with visible work', () => {
    const parent = makeGroup('parent')
    const child = makeGroup('child', 'parent')
    const empty = makeGroup('empty')
    const folderOnly = makeGroup('folder-only')
    const kept = filterProjectGroupsWithVisibleWork({
      projectGroups: [parent, child, empty, folderOnly],
      visibleWorktrees: [makeWorktree('wt', 'repo1')],
      visibleFolderWorkspaces: [makeFolderWorkspace('f', 'folder-only')],
      repoMap: new Map([['repo1', makeRepo('repo1', 'child')]])
    })
    expect(kept.map((group) => group.id)).toEqual(['parent', 'child', 'folder-only'])
  })

  it('keeps only the host whose catalog owns the visible work when ids collide', () => {
    const kept = filterProjectGroupsWithVisibleWork({
      projectGroups: [localOrch, runtimeOrch],
      visibleWorktrees: [makeWorktree('wt', 'runtimeRepo')],
      visibleFolderWorkspaces: [],
      repoMap: new Map([['runtimeRepo', makeRepo('runtimeRepo', 'orch', RUNTIME)]])
    })
    expect(kept).toEqual([runtimeOrch])
  })
})
