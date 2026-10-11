import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentMcpCapability,
  AgentMcpProviderObservation,
  AgentMcpServerObservation
} from '../../shared/agent-mcp-readiness'

function capabilitiesFor(status: McpServerStatus): AgentMcpCapability[] {
  const capabilities = new Set<AgentMcpCapability>()
  for (const tool of status.tools ?? []) {
    if (tool.annotations?.readOnly === true) {
      capabilities.add('read')
    }
    if (tool.annotations?.readOnly === false || tool.annotations?.destructive === true) {
      capabilities.add('write')
    }
  }
  return [...capabilities]
}

function serverState(status: McpServerStatus): AgentMcpServerObservation['state'] {
  return status.status === 'disabled' ? 'unavailable' : status.status
}

function capabilitiesVerified(status: McpServerStatus): boolean {
  return (
    status.status === 'connected' &&
    status.tools !== undefined &&
    status.tools.every(
      (tool) =>
        typeof tool.annotations?.readOnly === 'boolean' || tool.annotations?.destructive === true
    )
  )
}

/** Projects only readiness evidence. Provider config, URLs, errors, and tool text never cross. */
export function projectClaudeMcpServerStatus(
  statuses: readonly McpServerStatus[]
): AgentMcpProviderObservation {
  return {
    state: 'verified',
    servers: statuses.map((status) => ({
      name: status.name,
      state: serverState(status),
      capabilities: capabilitiesFor(status),
      capabilitiesVerified: capabilitiesVerified(status)
    }))
  }
}
