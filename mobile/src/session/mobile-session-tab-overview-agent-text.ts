/** What the worktree list's agent row says for one pane: its last words, then what it was asked. */
export type MobileSessionTabOverviewAgentText = {
  lastAssistantMessage: string | null
  prompt: string
}

export const NO_AGENT_TEXT: ReadonlyMap<string, MobileSessionTabOverviewAgentText> = new Map()

/**
 * The words of each agent row worktree.ps lists for one worktree, keyed by pane.
 *
 * Why the tab list needs these: once a turn ends the host rebuilds a tab's own status from the
 * terminal title, and that rebuild carries no message and no prompt, so a finished tab would read
 * blank. The worktree list's rows come straight from the agent's hook reports and keep both.
 */
export function readWorktreeAgentText(
  worktrees: readonly unknown[],
  worktreeId: string
): ReadonlyMap<string, MobileSessionTabOverviewAgentText> {
  const summary = worktrees.find((row) => isRecord(row) && row.worktreeId === worktreeId)
  const agents = isRecord(summary) && Array.isArray(summary.agents) ? summary.agents : []
  const text = new Map<string, MobileSessionTabOverviewAgentText>()
  for (const agent of agents) {
    if (!isRecord(agent) || typeof agent.paneKey !== 'string') {
      continue
    }
    text.set(agent.paneKey, {
      lastAssistantMessage:
        typeof agent.lastAssistantMessage === 'string' ? agent.lastAssistantMessage : null,
      prompt: typeof agent.prompt === 'string' ? agent.prompt : ''
    })
  }
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
