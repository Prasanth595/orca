import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import type { Worktree } from '../worktree/workspace-list-types'

type AgentRosterTitleInput = Pick<
  RuntimeWorktreeAgentRow,
  'taskTitle' | 'displayName' | 'prompt' | 'agentType'
>

type AgentRosterWorktreeDisplayInput = Pick<Worktree, 'workspaceKind'> & {
  repo?: unknown
  displayName?: unknown
  path?: unknown
  branch?: unknown
}

/** Title shown before the project name; orchestration metadata wins over provider output. */
export function agentRosterTitle(agent: AgentRosterTitleInput): string {
  const title =
    stringValue(agent.taskTitle) || stringValue(agent.displayName) || firstPromptLine(agent.prompt)
  if (title) {
    return title
  }
  const provider = stringValue(agent.agentType)
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Agent'
}

/** The actual folder is more useful than a user-facing worktree alias in a host-wide list. */
export function agentRosterProjectLabel(worktree: AgentRosterWorktreeDisplayInput): string {
  const repo = stringValue(worktree.repo)
  const displayName = stringValue(worktree.displayName)
  if (worktree.workspaceKind !== 'folder-workspace') {
    return repo || displayName || pathBasename(worktree.path)
  }
  return pathBasename(worktree.path) || displayName || repo
}

function pathBasename(path: unknown): string {
  const normalizedPath = stringValue(path).replace(/\\/g, '/').replace(/\/+$/, '')
  const basename = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
  return basename
}

function firstPromptLine(prompt: unknown): string {
  return (
    stringValue(prompt)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function agentRosterBranchLabel(worktree: AgentRosterWorktreeDisplayInput): string {
  return stringValue(worktree.branch)
}
