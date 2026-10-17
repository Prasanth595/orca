import type { AppState } from '../types'
import type { WorkspaceCleanupCandidate } from '../../../../shared/workspace-cleanup'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  getWorkspaceCleanupCandidateIdentity,
  resolveWorkspaceCleanupRemovalHostId
} from '../../../../shared/workspace-cleanup-host-identity'
import {
  buildActivityTabHostIndex,
  resolveActivityExecutionHostId
} from '@/components/activity/activity-event-builder-context'
import { buildWorktreeAgentRows } from '@/components/sidebar/worktree-agent-rows'
import {
  selectLiveAgentStatusEntriesForWorktree,
  selectRetainedAgentEntriesForWorktree
} from '@/components/sidebar/worktree-agent-row-selectors'
import { isExecutionHostAliasForWorktree } from '@/lib/worktree-execution-host-alias'
import {
  findIndexedDetectedWorktrees,
  findIndexedWorktreeOwnerForHost
} from '@/lib/worktree-runtime-owner-index'
import { translate } from '@/i18n/i18n'
import { getWorkspaceCleanupAgentStartedFailure } from './workspace-cleanup-preflight-failures'

export function assertWorkspaceCleanupAgentStopApproved(
  state: AppState,
  candidate: WorkspaceCleanupCandidate,
  approvedCandidate: WorkspaceCleanupCandidate | undefined
): void {
  const evidence = getWorkspaceCleanupAgentEvidence(state, [candidate]).get(
    getWorkspaceCleanupCandidateIdentity(candidate)
  )
  if (evidence === 'unknown') {
    throw new Error(
      translate(
        'auto.store.slices.workspace.cleanup.hostUnresolved',
        'Orca cannot tell which host owns this workspace. Refresh projects and review it again.'
      )
    )
  }
  if (evidence === 'live' && !approvedCandidate?.blockers.includes('live-agent')) {
    throw new Error(
      getWorkspaceCleanupAgentStartedFailure(
        {
          ...candidate,
          executionHostId: resolveWorkspaceCleanupRemovalHostId(candidate)
        },
        candidate
      ).message
    )
  }
}

/** Missing ownership remains a refusal, rather than becoming another host's agent or idle. */
export function getWorkspaceCleanupAgentEvidence(
  state: AppState,
  candidates: readonly WorkspaceCleanupCandidate[]
): Map<string, 'live' | 'unknown'> {
  const evidence = new Map<string, 'live' | 'unknown'>()
  const hostIndex = buildActivityTabHostIndex(state.unifiedTabsByWorktree)
  const candidatesByWorktreeId = new Map<string, WorkspaceCleanupCandidate[]>()
  for (const candidate of candidates) {
    const group = candidatesByWorktreeId.get(candidate.worktreeId) ?? []
    group.push(candidate)
    candidatesByWorktreeId.set(candidate.worktreeId, group)
  }
  for (const [worktreeId, worktreeCandidates] of candidatesByWorktreeId) {
    const rows = buildWorktreeAgentRows({
      tabs: state.tabsByWorktree[worktreeId] ?? [],
      entries: selectLiveAgentStatusEntriesForWorktree(state, worktreeId),
      retained: selectRetainedAgentEntriesForWorktree(state, worktreeId),
      runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
      ptyIdsByTabId: state.ptyIdsByTabId,
      terminalLayoutsByTabId: state.terminalLayoutsByTabId,
      runtimeAgentOrchestrationByPaneKey: state.runtimeAgentOrchestrationByPaneKey,
      paneForegroundAgentByPaneKey: state.paneForegroundAgentByPaneKey,
      now: Date.now()
    })
    for (const row of rows) {
      if (row.state !== 'working' && row.state !== 'blocked' && row.state !== 'waiting') {
        continue
      }
      const leafId = parsePaneKey(row.paneKey)?.leafId
      const ptyIds = state.ptyIdsByTabId[row.tab.id] ?? []
      const ptyId =
        (leafId && state.terminalLayoutsByTabId?.[row.tab.id]?.ptyIdsByLeafId?.[leafId]) ||
        row.tab.ptyId ||
        row.entry.terminalHandle ||
        (ptyIds.length === 1 ? ptyIds[0] : undefined)
      const hostId = resolveActivityExecutionHostId(
        { worktreeId, tab: row.tab },
        row.entry,
        ptyId,
        hostIndex
      )
      for (const candidate of worktreeCandidates) {
        const identity = getWorkspaceCleanupCandidateIdentity(candidate)
        const candidateHost = resolveWorkspaceCleanupRemovalHostId(candidate)
        if (!hostId || !candidateHost) {
          evidence.set(identity, 'unknown')
        } else {
          const owner =
            findIndexedWorktreeOwnerForHost(state.worktreesByRepo, worktreeId, candidateHost) ??
            findIndexedDetectedWorktrees(state.detectedWorktreesByRepo, worktreeId).find(
              (worktree) => isExecutionHostAliasForWorktree(candidateHost, worktree)
            )
          if (isExecutionHostAliasForWorktree(hostId, owner ?? { hostId: candidateHost })) {
            if (evidence.get(identity) !== 'unknown') {
              evidence.set(identity, 'live')
            }
          }
        }
      }
    }
  }
  return evidence
}
