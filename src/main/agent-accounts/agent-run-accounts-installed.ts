// Why type-only: spawn paths import this module, and the producer's graph must not load in workers.
import type { AgentRunAccounts, PaneLaunchFact } from './agent-run-accounts'

let installed: AgentRunAccounts | undefined

/** Installed beside the account services (desktop and `orca serve`); orcad has none. */
export function installAgentRunAccounts(producer: AgentRunAccounts | undefined): void {
  installed = producer
}

export function getAgentRunAccounts(): AgentRunAccounts | undefined {
  return installed
}

/** Called by both spawn-commit paths; a facet failure must never fail a spawn. */
export function noteAgentPaneLaunch(fact: PaneLaunchFact): void {
  try {
    installed?.notePaneLaunch(fact)
  } catch (error) {
    console.warn('[agent-run-accounts] Could not note a pane launch:', error)
  }
}
