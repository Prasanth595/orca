import { useAppStore } from '@/store'
import type { AgentType } from '../../../../../shared/agent-status-types'
import { shareCompatibleTitleIdentityGroup } from '../../../../../shared/agent-title-owner'
import { shouldRetireFinishedHarnessSnapshot } from '@/components/sidebar/retire-stale-harness-snapshot'

/**
 * Drops a finished harness's status from a pane that `occupant` now runs (#24854), including the
 * host's persisted row so a refresh cannot resurrect it. Live non-done hooks are never touched.
 */
export function retireSupersededHarnessStatus(paneKey: string, occupant: AgentType): void {
  const state = useAppStore.getState()
  const retained = state.retainedAgentsByPaneKey[paneKey]
  if (
    retained &&
    shouldRetireFinishedHarnessSnapshot({
      finishedAgent: retained.entry.agentType ?? retained.tab.launchAgent,
      finishedState: retained.entry.state,
      occupantAgent: occupant
    })
  ) {
    state.dismissRetainedAgent(paneKey)
  }
  const live = state.agentStatusByPaneKey[paneKey]
  // Why: dropAgentStatus also deletes the launch config, which may already be the occupant's.
  const launchConfigAgent = state.agentLaunchConfigByPaneKey[paneKey]?.identity.agentType
  if (
    live &&
    !shareCompatibleTitleIdentityGroup(launchConfigAgent, occupant) &&
    shouldRetireFinishedHarnessSnapshot({
      finishedAgent: live.agentType,
      finishedState: live.state,
      occupantAgent: occupant
    })
  ) {
    state.dropAgentStatus(paneKey)
  }
}
