import type {
  AgentMcpProviderObservation,
  AgentMcpServerObservation
} from '../../shared/agent-mcp-readiness'

export type CodexMcpReadinessTracker = {
  observed: boolean
  servers: Map<string, AgentMcpServerObservation>
}

export function createCodexMcpReadinessTracker(): CodexMcpReadinessTracker {
  return { observed: false, servers: new Map() }
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined
  }
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

function projectedState(
  status: string,
  failureReason: string | undefined
): AgentMcpServerObservation['state'] | undefined {
  if (status === 'ready') {
    return 'connected'
  }
  if (status === 'starting') {
    return 'pending'
  }
  if (status === 'failed') {
    return failureReason === 'reauthenticationRequired' ? 'needs-auth' : 'failed'
  }
  if (status === 'cancelled') {
    return 'unavailable'
  }
  return undefined
}

/** Records only server identity and status. Codex diagnostics and provider config never cross. */
export function observeCodexMcpServerStatus(
  tracker: CodexMcpReadinessTracker,
  method: string,
  params: unknown
): void {
  if (method !== 'mcpServer/startupStatus/updated') {
    return
  }
  const name =
    stringField(params, 'serverName') ??
    stringField(params, 'name') ??
    stringField(params, 'server')
  const status = stringField(params, 'status')
  if (!name || !status) {
    return
  }
  const state = projectedState(status, stringField(params, 'failureReason'))
  if (!state) {
    return
  }
  tracker.observed = true
  tracker.servers.set(name, {
    name,
    state,
    capabilities: [],
    capabilitiesVerified: false
  })
}

export function projectCodexMcpReadiness(
  tracker: CodexMcpReadinessTracker | undefined
): AgentMcpProviderObservation {
  if (!tracker?.observed) {
    return { state: 'unverifiable', servers: [] }
  }
  return { state: 'verified', servers: [...tracker.servers.values()] }
}

export function projectCodexSessionMcpReadiness(
  session: { mcpReadiness?: CodexMcpReadinessTracker } | undefined
): AgentMcpProviderObservation {
  return session
    ? projectCodexMcpReadiness(session.mcpReadiness)
    : { state: 'unavailable', servers: [] }
}
