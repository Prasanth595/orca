import type { GlobalSettings } from '../../shared/global-settings-types'
import type { AgentHookServer } from '../agent-hooks/server'
import {
  AgentRunAccounts,
  type AgentRunAccountSettings
} from '../agent-accounts/agent-run-accounts'
import { installAgentRunAccounts } from '../agent-accounts/agent-run-accounts-installed'
import type { ClaudeProfileRouter } from '../claude-accounts/claude-profile-router'
import { getCodexPaneAccount } from '../codex/codex-pane-account-registry'
import { getPtyIdForPaneKey } from '../ipc/pty/pane/key-state'

const ACCOUNT_LIST_SETTINGS = ['claudeManagedAccounts', 'codexManagedAccounts'] as const

/** Creates the run-account producer and feeds it status rows, statusline folders and account changes. */
export function startAgentRunAccounts(args: {
  server: AgentHookServer
  getSettings: () => AgentRunAccountSettings
  onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => void
  claudeRouter: ClaudeProfileRouter | null
}): AgentRunAccounts {
  const { server, claudeRouter } = args
  const producer = new AgentRunAccounts({
    republish: (paneKey, runAccount) => server.republishRunAccount(paneKey, runAccount),
    getRow: (paneKey) => server.getRunAccountRow(paneKey),
    listRows: () =>
      server.getStatusSnapshot().map((row) => ({
        paneKey: row.paneKey,
        connectionId: row.connectionId,
        providerSession: row.providerSession,
        runAccount: row.runAccount,
        structuredHost: row.structuredHost,
        payload: { agentType: row.agentType }
      })),
    getSettings: args.getSettings,
    getPtyIdForPaneKey,
    readCodexRecord: getCodexPaneAccount,
    claudeFolders: claudeRouter
      ? {
          accountHome: (accountId) => claudeRouter.accountHome(accountId),
          systemDefaultHome: () => claudeRouter.systemDefaultHome(),
          coveredBySystemDefault: (accountId) => claudeRouter.coveredBySystemDefault(accountId)
        }
      : null
  })
  installAgentRunAccounts(producer)
  server.subscribeEnrichedStatus((row) => {
    try {
      producer.noteStatus(row)
    } catch (error) {
      console.warn('[agent-run-accounts] Could not publish an agent account:', error)
    }
  })
  server.subscribeClaudeStatusLinePanes((event) => producer.noteClaudeStatusLine(event))
  args.onSettingsChanged((updates) => {
    if (ACCOUNT_LIST_SETTINGS.some((key) => key in updates)) {
      producer.refreshAll()
    }
  })
  return producer
}
