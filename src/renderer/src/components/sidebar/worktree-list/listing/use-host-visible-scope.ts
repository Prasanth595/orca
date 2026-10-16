import { useMemo } from 'react'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { SidebarWorktreeFilters } from './use-filters'
import { filterFolderWorkspacesFromOtherDevices } from '../../../../../../shared/workspace-creator-visibility'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts,
  getVisibleSidebarHostIdSet
} from './host-filtering'
import { mergeProjectGroupsAcrossHosts } from '../grouping/cross-host-project-group-merge'

// Narrows repos, project groups, and folder workspaces to the hosts (and devices) the
// current host filter admits.
export function useSidebarHostVisibleScope(args: {
  filterState: SidebarWorktreeFilters['filterState']
  defaultHostId: ExecutionHostId
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: readonly FolderWorkspace[]
  pairedDeviceIdsByEnvironment: Parameters<typeof filterFolderWorkspacesFromOtherDevices>[1]
}) {
  const { filterState, defaultHostId, repos, projectGroups, folderWorkspaces } = args
  const { visibleWorkspaceHostIds, workspaceHostScope, hideWorkspacesFromOtherDevices } =
    filterState
  const visibleHostIdSet = useMemo(
    () => getVisibleSidebarHostIdSet(visibleWorkspaceHostIds, workspaceHostScope),
    [visibleWorkspaceHostIds, workspaceHostScope]
  )
  const visibleReposForRows = useMemo(() => {
    if (!visibleHostIdSet) {
      return repos
    }
    return repos.filter((repo) => {
      const hostId =
        repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
      return visibleHostIdSet.has(hostId)
    })
  }, [defaultHostId, repos, visibleHostIdSet])
  // Why merge here: every reader of the visible groups (rows, reveal, header drag,
  // group dialogs) must agree on which header a group renders under.
  const projectGroupMerge = useMemo(
    () =>
      mergeProjectGroupsAcrossHosts(
        filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIdSet, defaultHostId),
        defaultHostId
      ),
    [defaultHostId, projectGroups, visibleHostIdSet]
  )
  const visibleFolderWorkspacesForRows = useMemo(() => {
    const hostVisibleWorkspaces = filterFolderWorkspacesForVisibleHosts(
      folderWorkspaces,
      projectGroups,
      visibleHostIdSet,
      defaultHostId
    )
    if (!hideWorkspacesFromOtherDevices) {
      return hostVisibleWorkspaces
    }
    return filterFolderWorkspacesFromOtherDevices(
      hostVisibleWorkspaces,
      args.pairedDeviceIdsByEnvironment
    )
  }, [
    args.pairedDeviceIdsByEnvironment,
    defaultHostId,
    folderWorkspaces,
    hideWorkspacesFromOtherDevices,
    projectGroups,
    visibleHostIdSet
  ])

  return {
    visibleReposForRows,
    visibleProjectGroupsForRows: projectGroupMerge.displayGroups,
    projectGroupMerge,
    visibleFolderWorkspacesForRows
  }
}
