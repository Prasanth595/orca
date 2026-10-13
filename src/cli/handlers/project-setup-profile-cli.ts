import type { ProjectMcpRequirement } from '../../shared/agent-mcp-readiness'
import type {
  WorkspaceSetupPolicyReadback,
  WorkspaceSetupProfile
} from '../../shared/workspace-setup-profile'
import { getRepeatedStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

export function formatWorkspaceSetupPolicy(result: WorkspaceSetupPolicyReadback): string {
  const profile = result.effectiveProfile?.name ?? 'none'
  const inherited = result.profileSource === 'inherited' ? ` from ${result.sourceWorktreeId}` : ''
  const requirements = result.tooling.requiredMcpCapabilities
    .map((requirement) => `${requirement.serverNames.join('|')}:${requirement.capability}`)
    .join(', ')
  const dryRun = result.dryRun
    ? `\ndryRun: mutated=false wouldRunSetup=${String(result.dryRun.wouldRunSetup)}`
    : ''
  return `setup profile: ${profile} (${result.profileSource}${inherited})\nsetup hook: ${result.hooks.setupConfigured ? result.hooks.setupSource : 'not configured'}\nsetup decision: requested=${result.hooks.requestedDecision} effective=${result.hooks.effectiveDecision}\nrequired MCP: ${requirements || 'none'}${dryRun}`
}

export function getOptionalMcpRequirements(
  flags: Map<string, string | boolean>
): ProjectMcpRequirement[] | undefined {
  if (!flags.has('required-mcp')) {
    return undefined
  }
  const values = getRepeatedStringFlag(flags, 'required-mcp')
  if (values.length === 1 && values[0] === '') {
    return []
  }
  return values.map((value) => {
    const separator = value.lastIndexOf(':')
    const serverNames = separator === -1 ? [] : value.slice(0, separator).split('|').filter(Boolean)
    const capability = separator === -1 ? '' : value.slice(separator + 1)
    if (
      serverNames.length === 0 ||
      serverNames.some((name) => name.trim().length === 0) ||
      (capability !== 'read' && capability !== 'write')
    ) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--required-mcp must be <server[|alternative]>:read or <server[|alternative]>:write'
      )
    }
    return { serverNames: serverNames.map((name) => name.trim()), capability }
  })
}

export function getOptionalSetupProfile(
  flags: Map<string, string | boolean>,
  getPresentStringFlag: (flags: Map<string, string | boolean>, name: string) => string | undefined
): WorkspaceSetupProfile | null | undefined {
  const name = getPresentStringFlag(flags, 'setup-profile')
  const setupDecision = getPresentStringFlag(flags, 'profile-setup')
  const requirements = getOptionalMcpRequirements(flags)
  if (name === undefined) {
    if (setupDecision !== undefined || requirements !== undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--profile-setup and --required-mcp require --setup-profile'
      )
    }
    return undefined
  }
  if (name === 'null') {
    if (setupDecision !== undefined || requirements !== undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--setup-profile null cannot be combined with --profile-setup or --required-mcp'
      )
    }
    return null
  }
  if (
    setupDecision !== undefined &&
    setupDecision !== 'run' &&
    setupDecision !== 'skip' &&
    setupDecision !== 'inherit'
  ) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--profile-setup must be one of: run, skip, inherit'
    )
  }
  return {
    name,
    ...(setupDecision ? { setupDecision } : {}),
    ...(requirements !== undefined ? { requiredMcpCapabilities: requirements } : {})
  }
}
