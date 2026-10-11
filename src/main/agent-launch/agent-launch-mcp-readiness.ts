import type { AgentLaunchResult } from '../../shared/agent-launch-intent'
import { evaluateAgentMcpReadiness } from '../../shared/agent-mcp-readiness'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { AgentLaunchExecution, AgentLaunchPublishedSurface } from './agent-launch-execution'
import { warnStructuredLaunchDowngrade } from './agent-launch-mode'

export async function withMcpReadiness(
  execution: AgentLaunchExecution,
  result: AgentLaunchResult
): Promise<AgentLaunchResult> {
  if (!execution.runtime.projectMcpRequirementsForWorkspace) {
    return result
  }
  const requirements = execution.runtime.projectMcpRequirementsForWorkspace(result.worktreeId)
  if (requirements.length === 0) {
    return {
      ...result,
      mcpReadiness: evaluateAgentMcpReadiness([], { state: 'unavailable', servers: [] })
    }
  }
  if (result.outcome.kind !== 'structured') {
    return {
      ...result,
      mcpReadiness: evaluateAgentMcpReadiness(requirements, {
        state: 'unverifiable',
        servers: []
      })
    }
  }
  const host = getStructuredAgentSessionHost()
  const mcpReadiness = host
    ? await host.readMcpReadiness(result.outcome.sessionId, requirements)
    : evaluateAgentMcpReadiness(requirements, { state: 'unverifiable', servers: [] })
  return { ...result, mcpReadiness }
}

export function withProvisionalMcpReadiness(
  execution: AgentLaunchExecution,
  surface: AgentLaunchPublishedSurface
): AgentLaunchPublishedSurface {
  if (!execution.runtime.projectMcpRequirementsForWorkspace) {
    return surface
  }
  const requirements = execution.runtime.projectMcpRequirementsForWorkspace(surface.worktreeId)
  return {
    ...surface,
    mcpReadiness: evaluateAgentMcpReadiness(requirements, {
      state: requirements.length === 0 ? 'unavailable' : 'unverifiable',
      servers: []
    })
  }
}

export function publishAgentLaunchSurface(
  execution: AgentLaunchExecution,
  surface: AgentLaunchPublishedSurface
): AgentLaunchPublishedSurface {
  const publishedSurface = withProvisionalMcpReadiness(execution, surface)
  warnStructuredLaunchDowngrade(execution.intent.agent, publishedSurface.receipt)
  execution.onSurfacePublished?.(publishedSurface)
  return publishedSurface
}
