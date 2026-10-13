import type { AgentMcpReadiness } from '../../shared/agent-mcp-readiness'
import type { RuntimeWorktreeRecord } from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { getRequiredWorktreeSelector } from '../selectors'

function formatMcpReadiness(result: AgentMcpReadiness): string {
  const lines = [`MCP readiness: ${result.state}`]
  for (const requirement of result.requirements) {
    const names = requirement.serverNames.join(' | ')
    const provider = requirement.satisfiedBy ? ` via ${requirement.satisfiedBy}` : ''
    lines.push(`  ${names} (${requirement.capability}): ${requirement.state}${provider}`)
  }
  return lines.join('\n')
}

export const AGENT_HANDLERS: Record<string, CommandHandler> = {
  'agent mcp-readiness': async ({ flags, client, cwd, json }) => {
    const sessionId = getOptionalStringFlag(flags, 'session')
    const worktree = getOptionalStringFlag(flags, 'worktree')
    const agent = getOptionalStringFlag(flags, 'agent')
    if (sessionId && (worktree || agent)) {
      throw new Error('Pass --session or --worktree with --agent, not both.')
    }
    if (!sessionId && (!worktree || !agent)) {
      throw new Error('Pass --session or both --worktree and --agent.')
    }
    const params: { sessionId: string } | { workspaceId: string; agent: string } = sessionId
      ? { sessionId }
      : {
          workspaceId: (
            await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
              worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
            })
          ).result.worktree.id,
          agent: getRequiredStringFlag(flags, 'agent')
        }
    const result = await client.call<AgentMcpReadiness>('agentSession.mcpReadiness', params)
    printResult(result, json, formatMcpReadiness)
  }
}
