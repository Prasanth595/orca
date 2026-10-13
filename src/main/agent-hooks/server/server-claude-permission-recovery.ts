import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import {
  canPollClaudePermission,
  hasSameClaudePermissionIdentity,
  isClaudePermissionResult
} from '../../../shared/agent-hook-listener/providers/claude-permission-poll'
import type { AgentHookAuthorityEvidence } from './server-types'

export function hasRestoredClaudePermissionAuthority(
  row: AgentHookEventPayload,
  commitments: readonly AgentHookAuthorityEvidence[],
  revoked: WeakSet<AgentHookAuthorityEvidence>
): boolean {
  return (
    row.restoredUnconfirmed === true &&
    row.connectionId === null &&
    row.launchToken === undefined &&
    canPollClaudePermission(row, true) &&
    Boolean(row.payload.toolName) &&
    commitments.some(
      (owner) =>
        owner.paneKey === row.paneKey &&
        owner.connectionId === null &&
        owner.tabId === row.tabId &&
        owner.worktreeId === row.worktreeId &&
        Boolean(owner.launchTokenHash) &&
        !revoked.has(owner)
    )
  )
}

/** The baseline is an in-process reference from the poll callback, never a wire field. */
export function canApplyRestoredClaudePermission(
  previous: AgentHookEventPayload | undefined,
  incoming: AgentHookEventPayload,
  baseline: AgentHookEventPayload | undefined,
  commitments: readonly AgentHookAuthorityEvidence[],
  revoked: WeakSet<AgentHookAuthorityEvidence>
): boolean {
  return (
    previous !== undefined &&
    previous === baseline &&
    hasRestoredClaudePermissionAuthority(previous, commitments, revoked) &&
    incoming.restoredUnconfirmed === true &&
    incoming.launchToken === undefined &&
    isClaudePermissionResult(incoming, true) &&
    hasSameClaudePermissionIdentity(previous, incoming) &&
    previous.toolUseId === incoming.toolUseId &&
    previous.toolAgentId === incoming.toolAgentId &&
    previous.toolAgentType === incoming.toolAgentType
  )
}
