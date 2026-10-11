import { normalizeProjectMcpRequirements, type ProjectMcpRequirement } from './agent-mcp-readiness'
import type { WorktreeLineage } from './worktree/lineage-types'
import type { WorktreeMeta } from './worktree/meta-types'

export type WorkspaceSetupProfile = {
  name: string
  /** Applied only when the create request itself still says inherit. */
  setupDecision?: 'run' | 'skip' | 'inherit'
  requiredMcpCapabilities?: ProjectMcpRequirement[]
}

export type WorkspaceSetupProfileResolution = {
  profile: WorkspaceSetupProfile
  source: 'direct' | 'inherited'
  sourceWorktreeId: string
}

export type WorkspaceSetupPolicyReadback = {
  worktreeId: string
  requestedProfile: WorkspaceSetupProfile | null
  effectiveProfile: WorkspaceSetupProfile | null
  profileSource: 'direct' | 'inherited' | 'none'
  sourceWorktreeId: string | null
  hooks: {
    setupConfigured: boolean
    archiveConfigured: boolean
    setupSource: 'yaml' | 'local' | 'both' | 'none'
    repositoryRunPolicy: 'ask' | 'run-by-default' | 'skip-by-default'
    requestedDecision: 'run' | 'skip' | 'inherit'
    effectiveDecision: 'run' | 'skip' | 'inherit'
  }
  tooling: {
    requiredMcpCapabilities: ProjectMcpRequirement[]
    source: 'profile' | 'project-host-setup' | 'none'
  }
  dryRun?: {
    mutated: false
    wouldRunSetup: boolean | null
    blocker?: 'setup-decision-required'
  }
}

export function normalizeWorkspaceSetupProfile(value: unknown): WorkspaceSetupProfile | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const name = 'name' in value && typeof value.name === 'string' ? value.name.trim() : ''
  if (!name) {
    return undefined
  }
  const setupDecision = 'setupDecision' in value ? value.setupDecision : undefined
  const requirements =
    'requiredMcpCapabilities' in value
      ? normalizeProjectMcpRequirements(value.requiredMcpCapabilities)
      : undefined
  return {
    name,
    ...(setupDecision === 'run' || setupDecision === 'skip' || setupDecision === 'inherit'
      ? { setupDecision }
      : {}),
    ...(requirements !== undefined ? { requiredMcpCapabilities: requirements } : {})
  }
}

/** Resolves a direct profile or the nearest valid ancestor profile without trusting stale lineage. */
export function resolveWorkspaceSetupProfile(
  worktreeId: string,
  metaByWorktreeId: Readonly<Record<string, WorktreeMeta | undefined>>,
  lineageByWorktreeId: Readonly<Record<string, WorktreeLineage | undefined>>
): WorkspaceSetupProfileResolution | null {
  const visited = new Set<string>()
  let currentId = worktreeId
  while (!visited.has(currentId)) {
    visited.add(currentId)
    const meta = metaByWorktreeId[currentId]
    const profile = normalizeWorkspaceSetupProfile(meta?.setupProfile)
    if (profile) {
      return {
        profile,
        source: currentId === worktreeId ? 'direct' : 'inherited',
        sourceWorktreeId: currentId
      }
    }
    const lineage = lineageByWorktreeId[currentId]
    if (!lineage) {
      return null
    }
    const parentMeta = metaByWorktreeId[lineage.parentWorktreeId]
    if (
      (meta?.instanceId && meta.instanceId !== lineage.worktreeInstanceId) ||
      (parentMeta?.instanceId && parentMeta.instanceId !== lineage.parentWorktreeInstanceId)
    ) {
      return null
    }
    currentId = lineage.parentWorktreeId
  }
  return null
}

export function setupDecisionWithWorkspaceProfile(
  requested: 'run' | 'skip' | 'inherit',
  resolution: WorkspaceSetupProfileResolution | null
): 'run' | 'skip' | 'inherit' {
  return requested === 'inherit' ? (resolution?.profile.setupDecision ?? 'inherit') : requested
}
