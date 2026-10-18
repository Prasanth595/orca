import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat-visual-directive'
import {
  agentDotState,
  agentRowTimeAt,
  agentStateLabel,
  formatTimeAgo,
  type AgentDotState
} from '../worktree/agent-row-display'
import type { MobileSessionTabOverviewAgentText } from './mobile-session-tab-overview-agent-text'
import type { MarkdownDocState, MobileSessionTab } from './mobile-session-route-types'
import { getMobileSessionTabTitle } from './mobile-terminal-tab-agent'

export type MobileSessionTabOverviewAgent = {
  state: AgentDotState
  /** The state in words ("Done", "Waiting for input"), or "Stopping…" while a Stop ends the turn. */
  label: string
  /** How long the agent has been in this state, in the worktree list's `5m` / `2h` form. */
  since: string | null
}

export type MobileSessionTabOverviewRow = {
  tab: MobileSessionTab
  title: string
  active: boolean
  /** Null when the tab has no live agent status to show, so the row draws no state. */
  agent: MobileSessionTabOverviewAgent | null
  /** A second look at the tab: the agent's last message or prompt, a file's path, a page's URL. */
  detail: string | null
  /** A one-tap close would discard these edits, so the row leaves Close to the tab's menu. */
  hasUnsavedEdits: boolean
}

// Mirrors NATIVE_CHAT_TURN_STATUS_COPY.stopping, as agent-row-display does.
const STOPPING_LABEL = 'Stopping…'

/** One row per session tab, in strip order, for the expanded all-tabs list. */
export function buildMobileSessionTabOverviewRows({
  tabs,
  titles,
  activeTabId,
  markdownDocs,
  agentText,
  now
}: {
  tabs: readonly MobileSessionTab[]
  titles: ReadonlyMap<string, string>
  activeTabId: string | null
  markdownDocs: ReadonlyMap<string, MarkdownDocState>
  /** The worktree list's agent words by pane, for a tab whose own status carries none. */
  agentText: ReadonlyMap<string, MobileSessionTabOverviewAgentText>
  now: number
}): MobileSessionTabOverviewRow[] {
  return tabs.map((tab) => {
    const title = titles.get(tab.id) ?? getMobileSessionTabTitle(tab)
    return {
      tab,
      title,
      active: tab.id === activeTabId,
      agent: terminalAgent(tab, now),
      detail: tabDetail(tab, title, agentText),
      hasUnsavedEdits: hasUnsavedEdits(tab, markdownDocs)
    }
  })
}

function terminalAgent(tab: MobileSessionTab, now: number): MobileSessionTabOverviewAgent | null {
  if (tab.type !== 'terminal' || !tab.agentStatus) {
    return null
  }
  // A status entry leaves `interrupted` out unless a Stop ended the turn; the worktree row always sets it.
  const status = { ...tab.agentStatus, interrupted: tab.agentStatus.interrupted === true }
  const state = agentDotState(status, now)
  const stopping = status.state === 'working' && status.mainAgent?.stopping === true
  const startedAt = agentRowTimeAt(status)
  return {
    state,
    label: stopping ? STOPPING_LABEL : agentStateLabel(state),
    since: startedAt > 0 ? formatTimeAgo(startedAt, now) : null
  }
}

function tabDetail(
  tab: MobileSessionTab,
  title: string,
  agentText: ReadonlyMap<string, MobileSessionTabOverviewAgentText>
): string | null {
  switch (tab.type) {
    case 'terminal': {
      // A finished turn's status is rebuilt from the terminal title without any words, so the
      // worktree list's row for the same pane speaks for it.
      const paneKey = tab.agentStatus?.paneKey
      return agentWords(tab.agentStatus) ?? (paneKey ? agentWords(agentText.get(paneKey)) : null)
    }
    case 'markdown':
    case 'file':
      return tab.relativePath && tab.relativePath !== title ? tab.relativePath : null
    case 'browser':
      return tab.url && tab.url !== title ? tab.url : null
    case 'agent-session':
      return null
  }
}

// Same order as the worktree list's agent row: the agent's last words, then what it was asked.
function agentWords(
  source: { lastAssistantMessage?: string | null; prompt?: string } | null | undefined
): string | null {
  const reply = source?.lastAssistantMessage
  const message = reply ? oneLine(withoutNativeChatVisualDirectiveLines(reply)) : ''
  return message || oneLine(source?.prompt ?? '') || null
}

// A clamped preview reads further when line breaks and indentation fold into single spaces.
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hasUnsavedEdits(
  tab: MobileSessionTab,
  markdownDocs: ReadonlyMap<string, MarkdownDocState>
): boolean {
  if (tab.type === 'markdown') {
    // Why: the tab list's isDirty can lag behind a phone draft; the local doc state is the authority.
    const doc = markdownDocs.get(tab.id)
    return tab.isDirty || (doc?.status === 'ready' && doc.isDirty)
  }
  return tab.type === 'file' && tab.isDirty
}
