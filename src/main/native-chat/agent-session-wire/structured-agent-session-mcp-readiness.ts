import type {
  AgentMcpProviderObservation,
  AgentMcpReadiness,
  ProjectMcpRequirement
} from '../../../shared/agent-mcp-readiness'
import { evaluateAgentMcpReadiness } from '../../../shared/agent-mcp-readiness'
import type { StructuredAgentSessionHostDeps } from './structured-agent-session-host-types'

export async function readStructuredAdapterMcpStatus(
  adapter: Pick<StructuredAgentSessionHostDeps['adapter'], 'readMcpStatus'>,
  sessionId: string
): Promise<AgentMcpProviderObservation> {
  return adapter.readMcpStatus
    ? await adapter.readMcpStatus(sessionId)
    : { state: 'unverifiable', servers: [] }
}

export async function readStructuredAgentMcpReadiness(
  deps: Pick<StructuredAgentSessionHostDeps, 'adapter' | 'store'>,
  sessionId: string,
  requirements: readonly ProjectMcpRequirement[]
): Promise<AgentMcpReadiness> {
  if (!deps.store.getRecord(sessionId)) {
    throw new Error(`no agent session ${sessionId}`)
  }
  const observation = await readStructuredAdapterMcpStatus(deps.adapter, sessionId)
  return evaluateAgentMcpReadiness(requirements, observation)
}
