import type { AgentRunAccount } from '../../../../shared/agent-run-account'
import type { AgentStatusEntry, AgentType } from '../../../../shared/agent-status-types'
import type { AgentStatusMetadata } from './agent-status-contract'

/**
 * The host is the only producer of the facet: a host row's value (or withdrawal) is copied as is,
 * while a renderer-local row (OSC title, launch seed) keeps what the host last said for that agent.
 */
export function resolveLiveEntryRunAccount(
  existing: AgentStatusEntry | undefined,
  metadata: AgentStatusMetadata | undefined,
  agentType: AgentType | undefined
): AgentRunAccount | undefined {
  if (metadata?.runAccount !== undefined) {
    return metadata.runAccount ?? undefined
  }
  return existing && existing.agentType === agentType ? existing.runAccount : undefined
}
