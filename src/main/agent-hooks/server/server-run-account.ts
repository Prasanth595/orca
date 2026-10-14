import { agentRunAccountsEqual, type AgentRunAccount } from '../../../shared/agent-run-account'
import type { AgentProviderSessionMetadata } from '../../../shared/agent-session-resume'
import type { AgentType } from '../../../shared/agent-status-types'
import {
  parseClaudeStatusLinePane,
  type ClaudeStatusLinePane
} from '../../../shared/claude-statusline-rate-limits'
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
  private readonly statusLinePaneListeners = new Set<(event: ClaudeStatusLinePane) => void>()

  /** Statusline posts name the folder the pane's Claude runs in, with or without usage. */
  subscribeClaudeStatusLinePanes(listener: (event: ClaudeStatusLinePane) => void): () => void {
    this.statusLinePaneListeners.add(listener)
    return () => {
      this.statusLinePaneListeners.delete(listener)
    }
  }

  protected override noteClaudeStatusLinePane(body: unknown): void {
    const event = this.statusLinePaneListeners.size > 0 ? parseClaudeStatusLinePane(body) : null
    if (!event) {
      return
    }
    const resolved = { ...event, paneKey: this.resolvePaneKeyAlias(event.paneKey) }
    for (const listener of this.statusLinePaneListeners) {
      try {
        listener(resolved)
      } catch (error) {
        console.error('[agent-hooks] statusline pane listener threw', error)
      }
    }
  }

  /** Restates a local row with a new facet (`null` withdraws it); nothing but the facet changes. */
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
    // Why flagged: the status did not change, so no title, bell, telemetry or first-work effect may run.
    this.onAgentStatus?.({ ...next, isReplay: true, runAccountOnly: true })
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
