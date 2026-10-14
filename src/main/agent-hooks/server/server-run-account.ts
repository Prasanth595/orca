import { agentRunAccountsEqual, type AgentRunAccount } from '../../../shared/agent-run-account'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'
import type { AgentType } from '../../../shared/agent-status-types'
import type { EnrichedAgentHookEventPayload } from './server-types'
import { AgentHookServerAgentPresence } from './server-agent-presence'

export type AgentRunAccountRow = {
  paneKey: string
  agentType: AgentType | undefined
  providerSession: AgentProviderSessionMetadata | undefined
  runAccount: AgentRunAccount | undefined
  connectionId: string | null
}

export abstract class AgentHookServerRunAccount extends AgentHookServerAgentPresence {
  /**
   * Restates a local row with a new run-account facet. Only the facet changes: timestamps,
   * observation and state stay as they were, and only the row, persistence and the renderer
   * see it — plugin and recorder listeners get nothing because no status changed.
   * `null` withdraws a facet the host published earlier.
   */
  republishRunAccount(paneKey: string, runAccount: AgentRunAccount | null): boolean {
    const resolved = this.resolvePaneKeyAlias(paneKey)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Main admits enriched legacy rows; the shared view declares their base event type.
    const previous = this.state.lastStatusByPaneKey.get(resolved) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!previous || previous.connectionId !== null || previous.structuredHost) {
      return false
    }
    if (agentRunAccountsEqual(previous.runAccount, runAccount)) {
      return false
    }
    const next: EnrichedAgentHookEventPayload = { ...previous, runAccount }
    if (!this.writeLegacyStatusRow(next)) {
      return false
    }
    this.commitStatusRowMutation(previous, next)
    this.scheduleStatusPersist()
    // Why a replay: the status is restated, not changed, so first-work effects must skip it.
    this.onAgentStatus?.({ ...next, isReplay: true })
    return true
  }

  getRunAccountRow(paneKey: string): AgentRunAccountRow | null {
    const resolved = this.resolvePaneKeyAlias(paneKey)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Main admits enriched legacy rows; the shared view declares their base event type.
    const row = this.state.lastStatusByPaneKey.get(resolved) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!row || row.structuredHost) {
      return null
    }
    return {
      paneKey: resolved,
      agentType: row.payload.agentType,
      providerSession: row.providerSession,
      runAccount: row.runAccount ?? undefined,
      connectionId: row.connectionId
    }
  }
}
