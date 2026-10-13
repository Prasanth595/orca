import type { ProjectMcpRequirement } from '../../shared/agent-mcp-readiness'
import type { Repo } from '../../shared/repo-types'
import type {
  WorkspaceSetupPolicyReadback,
  WorkspaceSetupProfile,
  WorkspaceSetupProfileResolution
} from '../../shared/workspace-setup-profile'
import {
  normalizeWorkspaceSetupProfile,
  setupDecisionWithWorkspaceProfile
} from '../../shared/workspace-setup-profile'
import { getEffectiveSetupRunPolicy, shouldRunSetupForCreate } from '../effective-hook-config'
import { getEffectiveHooks, getSetupCommandSource } from '../hooks'

export function readRuntimeWorkspaceSetupPolicy(args: {
  worktreeId: string
  worktreePath: string
  repo: Repo
  directProfile: WorkspaceSetupProfile | undefined
  profileResolution: WorkspaceSetupProfileResolution | null
  setupRequirements: ProjectMcpRequirement[]
  dryRun: boolean
}): WorkspaceSetupPolicyReadback {
  const requestedProfile = normalizeWorkspaceSetupProfile(args.directProfile) ?? null
  const effectiveProfile = args.profileResolution?.profile ?? null
  const requestedDecision = requestedProfile?.setupDecision ?? 'inherit'
  const effectiveDecision = setupDecisionWithWorkspaceProfile(
    requestedDecision,
    args.profileResolution
  )
  const hooks = getEffectiveHooks(args.repo, args.worktreePath)
  const setupSource = getSetupCommandSource(args.repo, args.worktreePath)?.source ?? 'none'
  const profileRequirements = effectiveProfile?.requiredMcpCapabilities
  const requiredMcpCapabilities = profileRequirements ?? args.setupRequirements
  const toolingSource =
    profileRequirements !== undefined
      ? 'profile'
      : args.setupRequirements.length > 0
        ? 'project-host-setup'
        : 'none'
  const result: WorkspaceSetupPolicyReadback = {
    worktreeId: args.worktreeId,
    requestedProfile,
    effectiveProfile,
    profileSource: args.profileResolution?.source ?? 'none',
    sourceWorktreeId: args.profileResolution?.sourceWorktreeId ?? null,
    hooks: {
      setupConfigured: Boolean(hooks?.scripts.setup),
      archiveConfigured: Boolean(hooks?.scripts.archive),
      setupSource,
      repositoryRunPolicy: getEffectiveSetupRunPolicy(args.repo),
      requestedDecision,
      effectiveDecision
    },
    tooling: { requiredMcpCapabilities, source: toolingSource }
  }
  if (!args.dryRun) {
    return result
  }
  if (!hooks?.scripts.setup) {
    return { ...result, dryRun: { mutated: false, wouldRunSetup: false } }
  }
  try {
    return {
      ...result,
      dryRun: {
        mutated: false,
        wouldRunSetup: shouldRunSetupForCreate(args.repo, effectiveDecision)
      }
    }
  } catch {
    return {
      ...result,
      dryRun: {
        mutated: false,
        wouldRunSetup: null,
        blocker: 'setup-decision-required'
      }
    }
  }
}
