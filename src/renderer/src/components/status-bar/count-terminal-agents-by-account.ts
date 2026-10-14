import type { AgentRunAccountProvider } from '../../../../shared/agent-run-account'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { getTabIdToWorktreeId } from '../sidebar/worktree-agent-row-selectors'

type CountCache = {
  rows: Readonly<Record<string, AgentStatusEntry>>
  tabsByWorktree: Readonly<Record<string, TerminalTab[]>>
  counts: Map<string, number>
}

let cache: CountCache | null = null

function countKey(
  provider: AgentRunAccountProvider,
  accountId: string | null,
  keptOnly = false
): string {
  return `${provider}:${accountId ?? ''}${keptOnly ? ':kept' : ''}`
}

/** Terminal agents on this host per provider and account, counting only rows whose tab is open. */
export function countTerminalAgentsByAccount(args: {
  rows: Readonly<Record<string, AgentStatusEntry>>
  tabsByWorktree: Readonly<Record<string, TerminalTab[]>>
  provider: AgentRunAccountProvider
  accountId: string | null
  /** Only agents a person kept on the account. */
  keptOnly?: boolean
}): number {
  if (!cache || cache.rows !== args.rows || cache.tabsByWorktree !== args.tabsByWorktree) {
    const openTabs = getTabIdToWorktreeId(args.tabsByWorktree)
    const counts = new Map<string, number>()
    for (const [paneKey, row] of Object.entries(args.rows)) {
      const facet = row.runAccount
      const tabId = parsePaneKey(paneKey)?.tabId
      if (!facet || facet.lane !== 'host' || row.connectionId || !tabId || !openTabs.has(tabId)) {
        continue
      }
      const key = countKey(facet.provider, facet.accountId)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (facet.mode === 'kept') {
        const keptKey = countKey(facet.provider, facet.accountId, true)
        counts.set(keptKey, (counts.get(keptKey) ?? 0) + 1)
      }
    }
    cache = { rows: args.rows, tabsByWorktree: args.tabsByWorktree, counts }
  }
  return cache.counts.get(countKey(args.provider, args.accountId, args.keptOnly)) ?? 0
}
