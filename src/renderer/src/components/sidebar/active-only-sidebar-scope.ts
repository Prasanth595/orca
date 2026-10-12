import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { catalogOwnsHost, getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'

type TabBuckets = Record<string, readonly unknown[]> | null | undefined
type GroupHostParts = Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>
type HostParts = Parameters<typeof getRepoExecutionHostId>[0]

/** Owner host of each group the Active view hides, keyed by group id (ids can repeat across hosts). */
export type ActiveViewHiddenGroups = ReadonlyMap<string, readonly ExecutionHostId[]>

export const NO_HIDDEN_GROUPS: ActiveViewHiddenGroups = new Map()

/**
 * Workspace ids the sidebar's "Active" view keeps: any open tab of any kind
 * (terminal, editor, browser, chat), or a live agent.
 *
 * Why tabs rather than live PTYs: the view also exists to find open work to
 * close, so an editor tab or an exited terminal still counts.
 */
export function getActiveOnlyWorkspaceIds(args: {
  unifiedTabWorktreeIds: readonly string[]
  tabsByWorktree: TabBuckets
  browserTabsByWorktree: TabBuckets
  worktreeIdsWithLiveAgent: ReadonlySet<string>
}): Set<string> {
  const ids = new Set([...args.worktreeIdsWithLiveAgent, ...args.unifiedTabWorktreeIds])
  for (const buckets of [args.tabsByWorktree, args.browserTabsByWorktree]) {
    for (const [worktreeId, tabs] of Object.entries(buckets ?? {})) {
      if (tabs.length > 0) {
        ids.add(worktreeId)
      }
    }
  }
  return ids
}

const unifiedTabWorktreeIdsCache = new WeakMap<Record<string, readonly unknown[]>, string[]>()

// Why cached per snapshot: the selector runs on every store write, and tab titles churn constantly.
export function getUnifiedTabWorktreeIds(
  unifiedTabsByWorktree: Record<string, readonly unknown[]> | null | undefined
): string[] {
  if (!unifiedTabsByWorktree) {
    return []
  }
  const cached = unifiedTabWorktreeIdsCache.get(unifiedTabsByWorktree)
  if (cached) {
    return cached
  }
  const ids = Object.entries(unifiedTabsByWorktree)
    .filter(([, tabs]) => tabs.length > 0)
    .map(([worktreeId]) => worktreeId)
  unifiedTabWorktreeIdsCache.set(unifiedTabsByWorktree, ids)
  return ids
}

export function addPinnedWorkspaceIds(
  activeIds: Set<string>,
  worktreesByRepo: Record<string, readonly Worktree[]>
): void {
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      if (worktree.isPinned) {
        activeIds.add(worktree.id)
      }
    }
  }
}

/** Persisted key for "Always mark inactive": host-qualified, since group ids repeat across hosts. */
export function getActiveViewGroupKey(group: GroupHostParts): string {
  return `${getProjectGroupHostId(group)}::${group.id}`
}

/** Groups marked "Always mark inactive", plus every group nested under them on the same host. */
export function getActiveViewHiddenGroups(
  projectGroups: readonly ProjectGroup[],
  markedGroupKeys: readonly string[]
): ActiveViewHiddenGroups {
  if (markedGroupKeys.length === 0) {
    return NO_HIDDEN_GROUPS
  }
  const marked = new Set(markedGroupKeys)
  const hiddenKeys = new Set(
    projectGroups.map(getActiveViewGroupKey).filter((key) => marked.has(key))
  )
  let grew = hiddenKeys.size > 0
  while (grew) {
    grew = false
    for (const group of projectGroups) {
      const key = getActiveViewGroupKey(group)
      const parentKey = group.parentGroupId
        ? `${getProjectGroupHostId(group)}::${group.parentGroupId}`
        : null
      if (!hiddenKeys.has(key) && parentKey && hiddenKeys.has(parentKey)) {
        hiddenKeys.add(key)
        grew = true
      }
    }
  }
  const hidden = new Map<string, ExecutionHostId[]>()
  for (const group of projectGroups) {
    if (hiddenKeys.has(getActiveViewGroupKey(group))) {
      hidden.set(group.id, [...(hidden.get(group.id) ?? []), getProjectGroupHostId(group)])
    }
  }
  return hidden
}

// Why catalogOwnsHost: the local catalog's groups also hold SSH rows, so host ids alone don't match.
function isInHiddenGroup(
  hidden: ActiveViewHiddenGroups,
  groupId: string | null | undefined,
  row: HostParts
): boolean {
  const hosts = groupId ? hidden.get(groupId) : undefined
  if (!hosts) {
    return false
  }
  const rowHostId = getRepoExecutionHostId(row)
  return hosts.some((hostId) => catalogOwnsHost(hostId, rowHostId))
}

/**
 * Runs after lineage-ancestor injection, since a visible child elsewhere would otherwise pull its
 * parent (e.g. an orchestrator worktree) and that parent's group back into the Active view.
 */
export function excludeHiddenGroupWorktrees(
  worktrees: Worktree[],
  hidden: ActiveViewHiddenGroups,
  repoMap: Map<string, Repo>,
  keepWorkspaceIds: ReadonlySet<string>
): Worktree[] {
  if (hidden.size === 0) {
    return worktrees
  }
  return worktrees.filter((worktree) => {
    if (keepWorkspaceIds.has(worktree.id) || worktree.isPinned) {
      return true
    }
    const repo = repoMap.get(worktree.repoId)
    return !repo || !isInHiddenGroup(hidden, repo.projectGroupId, repo)
  })
}

export function filterActiveOnlyFolderWorkspaces(
  folderWorkspaces: readonly FolderWorkspace[],
  activeIds: ReadonlySet<string>,
  keepWorkspaceId: string | null,
  hidden: ActiveViewHiddenGroups = NO_HIDDEN_GROUPS
): FolderWorkspace[] {
  return folderWorkspaces.filter((folderWorkspace) => {
    const key = folderWorkspaceKey(folderWorkspace.id)
    if (key === keepWorkspaceId || folderWorkspace.isPinned) {
      return true
    }
    return (
      activeIds.has(key) &&
      !isInHiddenGroup(hidden, folderWorkspace.projectGroupId, folderWorkspace)
    )
  })
}

// Why: group headers render even when empty, so the Active view drops groups with no visible work below them.
export function filterProjectGroupsWithVisibleWork(args: {
  projectGroups: readonly ProjectGroup[]
  visibleWorktrees: readonly Worktree[]
  visibleFolderWorkspaces: readonly FolderWorkspace[]
  repoMap: Map<string, Repo>
}): ProjectGroup[] {
  const groupsById = new Map<string, ProjectGroup[]>()
  for (const group of args.projectGroups) {
    groupsById.set(group.id, [...(groupsById.get(group.id) ?? []), group])
  }
  const findOwner = (groupId: string, row: HostParts): ProjectGroup | undefined => {
    const rowHostId = getRepoExecutionHostId(row)
    return groupsById
      .get(groupId)
      ?.find((group) => catalogOwnsHost(getProjectGroupHostId(group), rowHostId))
  }
  const keep = new Set<ProjectGroup>()
  const keepWithAncestors = (groupId: string | null | undefined, row: HostParts): void => {
    let current = groupId ? findOwner(groupId, row) : undefined
    while (current && !keep.has(current)) {
      keep.add(current)
      current = current.parentGroupId ? findOwner(current.parentGroupId, current) : undefined
    }
  }
  for (const worktree of args.visibleWorktrees) {
    const repo = args.repoMap.get(worktree.repoId)
    if (repo) {
      keepWithAncestors(repo.projectGroupId, repo)
    }
  }
  for (const folderWorkspace of args.visibleFolderWorkspaces) {
    keepWithAncestors(folderWorkspace.projectGroupId, folderWorkspace)
  }
  return args.projectGroups.filter((group) => keep.has(group))
}
