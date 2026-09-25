import { getAgentRowConversationName } from '../../shared/agent-row-conversation-name'
import type { AgentType } from '../../shared/agent-status-types'
import { parsePaneKey } from '../../shared/stable-pane-id'
import type { TerminalTab } from '../../shared/terminal-tab-types'
import type { RuntimeWorktreeAgentSource } from './runtime-worktree-agent-source'

type OrchestrationParent = {
  parentPaneKey?: string | null
}

/**
 * Stable names for mobile worktree.ps agent rows. Desktop already resolves
 * these in the renderer; the phone only receives the ps payload (#20444).
 */
export function resolveWorktreeAgentConversationNames(args: {
  sources: Iterable<RuntimeWorktreeAgentSource>
  tabsByWorktree: Record<string, readonly TerminalTab[]> | null | undefined
  generatedTitlesEnabled: boolean
  orchestrationByPaneKey: Record<string, OrchestrationParent> | null | undefined
}): Map<string, string> {
  const sources = [...args.sources]
  const tabsById = indexTabs(args.tabsByWorktree)
  const sourcesPerTab = countSourcesPerTab(sources)
  const names = new Map<string, string>()
  for (const source of sources) {
    const tabId = source.tabId ?? parsePaneKey(source.paneKey)?.tabId
    if (!tabId || sharesParentTab(source, tabId, args.orchestrationByPaneKey)) {
      continue
    }
    const tab = tabsById.get(tabId)
    if (!tab) {
      continue
    }
    // A split tab's live title belongs to the focused pane. Tab-owned names
    // (custom, quick command, generated) still apply to every pane.
    const paneLiveTitle = (sourcesPerTab.get(tabId) ?? 0) > 1 ? null : undefined
    const name = getAgentRowConversationName(
      tab,
      source.agentType as AgentType | null,
      args.generatedTitlesEnabled,
      paneLiveTitle
    )
    if (name) {
      names.set(source.paneKey, name)
    }
  }
  return names
}

function indexTabs(
  tabsByWorktree: Record<string, readonly TerminalTab[]> | null | undefined
): Map<string, TerminalTab> {
  const tabsById = new Map<string, TerminalTab>()
  if (!tabsByWorktree) {
    return tabsById
  }
  for (const tabs of Object.values(tabsByWorktree)) {
    for (const tab of tabs) {
      tabsById.set(tab.id, tab)
    }
  }
  return tabsById
}

function countSourcesPerTab(sources: readonly RuntimeWorktreeAgentSource[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const source of sources) {
    const tabId = source.tabId ?? parsePaneKey(source.paneKey)?.tabId
    if (!tabId) {
      continue
    }
    counts.set(tabId, (counts.get(tabId) ?? 0) + 1)
  }
  return counts
}

function sharesParentTab(
  source: RuntimeWorktreeAgentSource,
  tabId: string,
  orchestrationByPaneKey: Record<string, OrchestrationParent> | null | undefined
): boolean {
  const parentPaneKey = orchestrationByPaneKey?.[source.paneKey]?.parentPaneKey
  if (!parentPaneKey) {
    return false
  }
  return parsePaneKey(parentPaneKey)?.tabId === tabId
}
