import type { ProjectMcpRequirement } from '../../shared/agent-mcp-readiness'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { Repo } from '../../shared/repo-types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import {
  resolveWorkspaceSetupProfile,
  type WorkspaceSetupPolicyReadback
} from '../../shared/workspace-setup-profile'
import { readAllWorktreeMetaForRepo } from '../persistence/host-qualified-worktree-meta'
import type { RuntimeStore } from './runtime-store-contract'
import { readRuntimeWorkspaceSetupPolicy } from './runtime-workspace-setup-policy'

function setupRequirementsForWorkspace(
  store: RuntimeStore,
  workspaceId: string,
  meta: WorktreeMeta | undefined = store.getWorktreeMeta(workspaceId)
): ProjectMcpRequirement[] {
  const setups = store.getProjectHostSetups?.() ?? []
  const exact = meta?.projectHostSetupId
    ? setups.find((setup) => setup.id === meta.projectHostSetupId)
    : undefined
  if (exact) {
    return exact.requiredMcpCapabilities ?? []
  }
  const repoId = splitWorktreeIdForFilesystem(workspaceId)?.repoId
  const fallback = repoId
    ? setups.find(
        (setup) =>
          setup.repoId === repoId && (meta?.hostId === undefined || setup.hostId === meta.hostId)
      )
    : undefined
  return fallback?.requiredMcpCapabilities ?? []
}

export function projectMcpRequirementsForWorkspace(
  store: RuntimeStore | null,
  workspaceId: string
): ProjectMcpRequirement[] {
  if (!store) {
    return []
  }
  const metaByWorktreeId = store.getAllWorktreeMeta()
  const resolution = resolveWorkspaceSetupProfile(
    workspaceId,
    metaByWorktreeId,
    store.getAllWorktreeLineage?.() ?? {}
  )
  return resolution?.profile.requiredMcpCapabilities !== undefined
    ? resolution.profile.requiredMcpCapabilities
    : setupRequirementsForWorkspace(store, workspaceId, metaByWorktreeId[workspaceId])
}

export function readProjectWorkspaceSetupPolicy(input: {
  store: RuntimeStore | null
  repos: Repo[]
  workspaceId: string
  dryRun: boolean
  executionHostId?: ExecutionHostId
}): WorkspaceSetupPolicyReadback {
  if (!input.store) {
    throw new Error('runtime_unavailable')
  }
  const parsed = splitWorktreeIdForFilesystem(input.workspaceId)
  if (!parsed) {
    throw new Error(`Invalid worktree id: ${input.workspaceId}`)
  }
  const repo = input.repos.find(
    (candidate) =>
      candidate.id === parsed.repoId &&
      (input.executionHostId === undefined ||
        getRepoExecutionHostId(candidate) === input.executionHostId)
  )
  if (!repo) {
    throw new Error(`Repository not found for worktree: ${input.workspaceId}`)
  }
  const metaByWorktreeId = readAllWorktreeMetaForRepo(input.store, repo)
  const meta = metaByWorktreeId[input.workspaceId]
  const profileResolution = resolveWorkspaceSetupProfile(
    input.workspaceId,
    metaByWorktreeId,
    input.store.getAllWorktreeLineage?.() ?? {}
  )
  return readRuntimeWorkspaceSetupPolicy({
    worktreeId: input.workspaceId,
    worktreePath: parsed.worktreePath,
    repo,
    directProfile: meta?.setupProfile,
    profileResolution,
    setupRequirements: setupRequirementsForWorkspace(input.store, input.workspaceId, meta),
    dryRun: input.dryRun
  })
}
