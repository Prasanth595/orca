// Claude's `system:init` lists every MCP server with its connect status. The frame itself is session
// inventory, but a server that failed to connect is news the user can act on: its tools are missing
// from the session. Init repeats every request cycle, so each failure is reported once per session.

import type { AgentJournalStatusItem } from '../../shared/agent-session-journal-types'
import {
  boundInlineText,
  DEFAULT_JOURNAL_PAYLOAD_LIMITS
} from '../native-chat/agent-session-journal/journal-payload-bounds'
import { claudeRecord, claudeText } from './claude-structured-item-translation'

export const CLAUDE_INIT_FRAME_KIND = 'message:system:init'

function failedMcpServerNames(message: Record<string, unknown>): string[] {
  const servers = Array.isArray(message.mcp_servers) ? message.mcp_servers : []
  return servers.flatMap((entry) => {
    const server = claudeRecord(entry)
    const name = claudeText(server?.name)
    return name && server?.status === 'failed' ? [name] : []
  })
}

/** Tracks which servers this session already reported, so a repeated init writes nothing. */
export function createClaudeMcpConnectFailureRows(): (
  message: Record<string, unknown>
) => AgentJournalStatusItem | null {
  const reported = new Set<string>()
  return (message) => {
    const fresh = failedMcpServerNames(message).filter((name) => !reported.has(name))
    if (fresh.length === 0) {
      return null
    }
    for (const name of fresh) {
      reported.add(name)
    }
    const subject =
      fresh.length === 1
        ? `MCP server "${fresh[0]}" failed to connect, so its tools are unavailable in this session.`
        : `MCP servers ${fresh.map((name) => `"${name}"`).join(', ')} failed to connect, so their tools are unavailable in this session.`
    const text = `${subject} Run \`claude mcp list\` in a terminal to see why.`
    return {
      kind: 'status',
      tone: 'warning',
      text: boundInlineText(text, DEFAULT_JOURNAL_PAYLOAD_LIMITS).text
    }
  }
}
