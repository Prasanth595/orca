import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getAgentStatusEpochNow } from '@/lib/agent-status-epoch-clock'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import type { Repo } from '../../../../../../shared/repo-types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { computeVisibleWorktrees } from '../../visible-worktrees'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment
} from '../../workspace-creator-visibility'
import {
  getVisibleWorktreeBrowserActivityTabs,
  getVisibleWorktreeTerminalActivityTabs,
  getStructuredChatWorktreeIds
} from '../../visible-worktree-activity-inputs'
import {
  addPinnedWorkspaceIds,
  excludeHiddenGroupWorktrees,
  getActiveOnlyWorkspaceIds,
  getActiveViewHiddenGroups,
  getUnifiedTabWorktreeIds,
  NO_HIDDEN_GROUPS
} from '../../active-only-sidebar-scope'
import type { SortBy } from '../../smart-sort'
import type { SidebarWorktreeFilters } from './use-filters'
import { useReusedArrayIdentity } from './use-reused-array-identity'

const EMPTY_WORKTREE_ID_SET: ReadonlySet<string> = new Set()
const NO_IDS: string[] = []

// Applies every sidebar filter to the sorted id stream. Flatten/filter/sort goes through the
// shared utility so card order matches Cmd+1–9 numbering.
export function useVisibleSidebarWorktrees(args: {
  filterState: SidebarWorktreeFilters['filterState']
  sortBy: SortBy
  sortedIds: string[]
  repoMap: Map<string, Repo>
  worktreeLineageById: Record<string, WorktreeLineage>
  /** Pre-derived focused host; the whole `settings` object would re-key this
   *  423-workspace scan on every unrelated settings write. */
  defaultHostId: ExecutionHostId
  agentSendTargetWorktreeId: string | null
  /** Hierarchy "Active" view, and the selected workspace it must never hide. */
  activeOnly?: boolean
  currentWorkspaceId?: string | null
}) {
  const { filterState, sortBy, sortedIds, repoMap, worktreeLineageById, defaultHostId } = args
  const {
    showSleepingWorkspaces,
    filterRepoIds,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces,
    hideWorkspacesFromOtherDevices,
    alwaysShowDefaultBranchWorkspace,
    visibleWorkspaceHostIds,
    workspaceHostScope
  } = filterState
  const activeOnly = args.activeOnly === true
  // Why gated: Classic must not rescan every workspace on each selection change.
  const currentWorkspaceId = activeOnly ? (args.currentWorkspaceId ?? null) : null
  const needsLiveAgents = !showSleepingWorkspaces || activeOnly
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const agentStatusEpoch = useAppStore((s) => (needsLiveAgents ? s.agentStatusEpoch : 0))
  // Why: skip the clock entirely when the epoch is the opt-out sentinel, so a
  // sleeping-workspaces list cannot evict the sample the live lists share.
  const agentStatusNow = needsLiveAgents ? getAgentStatusEpochNow(agentStatusEpoch) : 0
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const pairedDeviceIdsByEnvironment = useMemo(
    () =>
      hideWorkspacesFromOtherDevices
        ? getPairedDeviceIdsByEnvironment(runtimeEnvironments, runtimeStatusByEnvironmentId)
        : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    [hideWorkspacesFromOtherDevices, runtimeEnvironments, runtimeStatusByEnvironmentId]
  )

  // Read tabsByWorktree when needed for filtering or sorting
  const needsActivityMaps = needsLiveAgents || sortBy === 'smart'
  const tabsByWorktree = useAppStore((s) =>
    needsActivityMaps ? getVisibleWorktreeTerminalActivityTabs(s.tabsByWorktree) : null
  )
  const ptyIdsByTabId = useAppStore((s) => (needsActivityMaps ? s.ptyIdsByTabId : null))
  const browserTabsByWorktree = useAppStore((s) =>
    needsLiveAgents ? getVisibleWorktreeBrowserActivityTabs(s.browserTabsByWorktree) : null
  )
  const worktreeIdsWithStructuredChat = useAppStore((s) =>
    getStructuredChatWorktreeIds(showSleepingWorkspaces, s.unifiedTabsByWorktree)
  )
  const unifiedTabWorktreeIds = useAppStore(
    useShallow((s) => (activeOnly ? getUnifiedTabWorktreeIds(s.unifiedTabsByWorktree) : NO_IDS))
  )
  const activeViewHiddenGroupKeys = useAppStore((s) => s.activeViewHiddenProjectGroupIds)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const activeViewHiddenGroups = useMemo(
    () =>
      activeOnly
        ? getActiveViewHiddenGroups(projectGroups ?? [], activeViewHiddenGroupKeys ?? [])
        : NO_HIDDEN_GROUPS,
    [activeOnly, activeViewHiddenGroupKeys, projectGroups]
  )
  const agentSendTargetWorktreeId = args.agentSendTargetWorktreeId

  const recomputed = useMemo(() => {
    // Keyed on the epoch, not `agentStatusNow`: two bumps in one millisecond
    // share a sample, so the timestamp alone would not re-key this memo.
    void agentStatusEpoch
    // Why snapshot on agentStatusEpoch: update membership immediately without repainting on every hook ping.
    const liveAgentWorktreeIds = needsLiveAgents
      ? getWorktreeIdsWithLiveAgent(
          useAppStore.getState().agentStatusByPaneKey,
          tabsByWorktree,
          agentStatusNow
        )
      : EMPTY_WORKTREE_ID_SET
    let activeOnlyWorkspaceIds: Set<string> | null = null
    if (activeOnly) {
      activeOnlyWorkspaceIds = getActiveOnlyWorkspaceIds({
        unifiedTabWorktreeIds,
        tabsByWorktree,
        browserTabsByWorktree,
        worktreeIdsWithLiveAgent: liveAgentWorktreeIds
      })
      addPinnedWorkspaceIds(activeOnlyWorkspaceIds, worktreesByRepo)
      if (currentWorkspaceId) {
        // Why: hiding the row you are on would make the selection vanish from the tree.
        activeOnlyWorkspaceIds.add(currentWorkspaceId)
      }
    }
    const worktrees = computeVisibleWorktrees(worktreesByRepo, sortedIds, {
      filterRepoIds,
      showSleepingWorkspaces,
      tabsByWorktree,
      ptyIdsByTabId,
      browserTabsByWorktree,
      worktreeIdsWithStructuredChat,
      worktreeIdsWithLiveAgent: showSleepingWorkspaces
        ? EMPTY_WORKTREE_ID_SET
        : liveAgentWorktreeIds,
      activeOnlyWorkspaceIds,
      hideDefaultBranchWorkspace,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDetachedHeadWorkspaces,
      hideWorkspacesFromOtherDevices,
      pairedDeviceIdsByEnvironment,
      alwaysShowDefaultBranchWorkspace,
      repoMap,
      workspaceHostScope,
      visibleWorkspaceHostIds,
      defaultHostId,
      worktreeLineageById,
      preserveLineageParentOrder: sortBy === 'manual',
      forcedVisibleWorktreeIds: agentSendTargetWorktreeId ? [agentSendTargetWorktreeId] : undefined
    })
    if (!activeOnlyWorkspaceIds) {
      return { worktrees, activeOnlyWorkspaceIds }
    }
    const keepIds = new Set(
      [currentWorkspaceId, agentSendTargetWorktreeId].filter((id): id is string => id !== null)
    )
    return {
      worktrees: excludeHiddenGroupWorktrees(worktrees, activeViewHiddenGroups, repoMap, keepIds),
      activeOnlyWorkspaceIds
    }
  }, [
    activeOnly,
    activeViewHiddenGroups,
    currentWorkspaceId,
    needsLiveAgents,
    unifiedTabWorktreeIds,
    agentSendTargetWorktreeId,
    agentStatusEpoch,
    agentStatusNow,
    filterRepoIds,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces,
    hideWorkspacesFromOtherDevices,
    alwaysShowDefaultBranchWorkspace,
    workspaceHostScope,
    visibleWorkspaceHostIds,
    defaultHostId,
    repoMap,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    sortedIds,
    sortBy,
    worktreeLineageById,
    worktreesByRepo,
    pairedDeviceIdsByEnvironment,
    worktreeIdsWithStructuredChat
  ])
  // Why: agentStatusEpoch bumps recompute this memo even when membership and
  // order are unchanged; keeping the previous identity stops the whole
  // rows/sectionRows/renderedWorktrees chain from churning per epoch.
  const visibleWorktrees = useReusedArrayIdentity(recomputed.worktrees)

  return {
    visibleWorktrees,
    pairedDeviceIdsByEnvironment,
    activeOnlyWorkspaceIds: recomputed.activeOnlyWorkspaceIds,
    activeViewHiddenGroups
  }
}
