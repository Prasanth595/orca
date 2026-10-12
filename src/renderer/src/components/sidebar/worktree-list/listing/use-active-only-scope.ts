import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import {
  filterActiveOnlyFolderWorkspaces,
  filterProjectGroupsWithVisibleWork,
  type ActiveViewHiddenGroups
} from '../../active-only-sidebar-scope'
import type { useSidebarHostVisibleScope } from './use-host-visible-scope'
import { useReusedArrayIdentity } from './use-reused-array-identity'

type HostVisibleScope = ReturnType<typeof useSidebarHostVisibleScope>

const NO_FOLDER_WORKSPACES: FolderWorkspace[] = []
const NO_PROJECT_GROUPS: ProjectGroup[] = []

// Narrows folder workspaces and project groups to open work while the "Active" view is on.
export function useActiveOnlySidebarScope(args: {
  hostVisibleScope: HostVisibleScope
  activeOnlyWorkspaceIds: ReadonlySet<string> | null
  activeViewHiddenGroups: ActiveViewHiddenGroups
  currentWorkspaceId: string | null
  visibleWorktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
}): HostVisibleScope {
  const {
    hostVisibleScope,
    activeOnlyWorkspaceIds,
    activeViewHiddenGroups,
    currentWorkspaceId,
    visibleWorktrees,
    repoMap
  } = args
  const recomputedFolderWorkspaces = useMemo(
    () =>
      activeOnlyWorkspaceIds
        ? filterActiveOnlyFolderWorkspaces(
            hostVisibleScope.visibleFolderWorkspacesForRows,
            activeOnlyWorkspaceIds,
            currentWorkspaceId,
            activeViewHiddenGroups
          )
        : NO_FOLDER_WORKSPACES,
    [
      activeOnlyWorkspaceIds,
      activeViewHiddenGroups,
      currentWorkspaceId,
      hostVisibleScope.visibleFolderWorkspacesForRows
    ]
  )
  // Why: the active id set is rebuilt on every agent-status epoch; keep identities stable so rows don't rebuild.
  const activeFolderWorkspaces = useReusedArrayIdentity(recomputedFolderWorkspaces)
  const visibleFolderWorkspacesForRows = activeOnlyWorkspaceIds
    ? activeFolderWorkspaces
    : hostVisibleScope.visibleFolderWorkspacesForRows
  const recomputedProjectGroups = useMemo(
    () =>
      activeOnlyWorkspaceIds
        ? filterProjectGroupsWithVisibleWork({
            projectGroups: hostVisibleScope.visibleProjectGroupsForRows,
            visibleWorktrees,
            visibleFolderWorkspaces: visibleFolderWorkspacesForRows,
            repoMap
          })
        : NO_PROJECT_GROUPS,
    [
      activeOnlyWorkspaceIds,
      hostVisibleScope.visibleProjectGroupsForRows,
      repoMap,
      visibleFolderWorkspacesForRows,
      visibleWorktrees
    ]
  )
  const activeProjectGroups = useReusedArrayIdentity(recomputedProjectGroups)
  const visibleProjectGroupsForRows = activeOnlyWorkspaceIds
    ? activeProjectGroups
    : hostVisibleScope.visibleProjectGroupsForRows
  const setVisibleCount = useAppStore((s) => s.setSidebarActiveOnlyVisibleCount)
  const visibleCount = activeOnlyWorkspaceIds
    ? visibleWorktrees.length + visibleFolderWorkspacesForRows.length
    : null
  useEffect(() => {
    // Why only while active: the toggle hides the count when off, so Classic never writes it.
    if (visibleCount !== null) {
      setVisibleCount(visibleCount)
    }
  }, [setVisibleCount, visibleCount])
  return useMemo(
    () => ({
      visibleReposForRows: hostVisibleScope.visibleReposForRows,
      visibleProjectGroupsForRows,
      visibleFolderWorkspacesForRows
    }),
    [
      hostVisibleScope.visibleReposForRows,
      visibleFolderWorkspacesForRows,
      visibleProjectGroupsForRows
    ]
  )
}
