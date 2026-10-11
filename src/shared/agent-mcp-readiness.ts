export type AgentMcpCapability = 'read' | 'write'

export type ProjectMcpRequirement = {
  /** Configured server names that may satisfy this requirement, in preference order. */
  serverNames: string[]
  capability: AgentMcpCapability
}

export type AgentMcpServerState = 'connected' | 'needs-auth' | 'pending' | 'failed' | 'unavailable'

export type AgentMcpServerObservation = {
  name: string
  state: AgentMcpServerState
  /** Capabilities proven from the live provider's tool metadata. */
  capabilities: AgentMcpCapability[]
  /** False when the provider reported connection state but not enough tool metadata to prove caps. */
  capabilitiesVerified: boolean
}

export type AgentMcpProviderObservation =
  | { state: 'verified'; servers: AgentMcpServerObservation[] }
  | { state: 'unavailable'; servers: [] }
  | { state: 'unverifiable'; servers: [] }

export type AgentMcpRequirementResult = ProjectMcpRequirement & {
  state: AgentMcpServerState | 'unverifiable'
  satisfiedBy?: string
}

export type AgentMcpReadiness = {
  state: 'ready' | 'blocked' | 'unverifiable'
  requirements: AgentMcpRequirementResult[]
  /** Sanitized live projection. No config, URLs, errors, environment, descriptions, or tokens. */
  servers: AgentMcpServerObservation[]
}

function normalizedServerName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function matchingServers(
  requirement: ProjectMcpRequirement,
  observations: readonly AgentMcpServerObservation[]
): AgentMcpServerObservation[] {
  const names = new Set(requirement.serverNames.map(normalizedServerName))
  return observations.filter((server) => names.has(normalizedServerName(server.name)))
}

function requirementResult(
  requirement: ProjectMcpRequirement,
  observation: AgentMcpProviderObservation
): AgentMcpRequirementResult {
  if (observation.state !== 'verified') {
    return {
      ...requirement,
      state: observation.state === 'unavailable' ? 'unavailable' : 'unverifiable'
    }
  }
  const candidates = matchingServers(requirement, observation.servers)
  const connected = candidates.find(
    (server) => server.state === 'connected' && server.capabilities.includes(requirement.capability)
  )
  if (connected) {
    return { ...requirement, state: 'connected', satisfiedBy: connected.name }
  }

  const connectedWithoutCapability = candidates.filter((server) => server.state === 'connected')
  if (connectedWithoutCapability.some((server) => !server.capabilitiesVerified)) {
    return { ...requirement, state: 'unverifiable' }
  }

  const precedence: AgentMcpServerState[] = ['needs-auth', 'pending', 'failed']
  for (const state of precedence) {
    const candidate = candidates.find((server) => server.state === state)
    if (candidate) {
      return { ...requirement, state, satisfiedBy: candidate.name }
    }
  }

  return { ...requirement, state: 'unavailable' }
}

export function evaluateAgentMcpReadiness(
  requirements: readonly ProjectMcpRequirement[],
  observation: AgentMcpProviderObservation
): AgentMcpReadiness {
  const results = requirements.map((requirement) => requirementResult(requirement, observation))
  const state = results.every((result) => result.state === 'connected')
    ? 'ready'
    : results.some((result) => result.state === 'unverifiable')
      ? 'unverifiable'
      : 'blocked'
  return {
    state,
    requirements: results,
    servers: observation.state === 'verified' ? observation.servers : []
  }
}

export function normalizeProjectMcpRequirements(value: unknown): ProjectMcpRequirement[] {
  if (!Array.isArray(value)) {
    return []
  }
  const normalized: ProjectMcpRequirement[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const serverNames =
      'serverNames' in entry && Array.isArray(entry.serverNames)
        ? entry.serverNames
            .filter((name): name is string => typeof name === 'string')
            .map((name) => name.trim())
            .filter(Boolean)
        : []
    const capability = 'capability' in entry ? entry.capability : undefined
    if (
      serverNames.length > 0 &&
      (capability === 'read' || capability === 'write') &&
      !normalized.some(
        (candidate) =>
          candidate.capability === capability &&
          candidate.serverNames.join('\u0000') === serverNames.join('\u0000')
      )
    ) {
      normalized.push({ serverNames, capability })
    }
  }
  return normalized
}
