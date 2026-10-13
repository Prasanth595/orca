import { mainAgentStatusEqual } from '../../../shared/main-agent-status'
import {
  claudeTeammateIdMatchesName,
  isClaudeChildTurnEndEvent
} from '../../../shared/claude-subagent-roster'
import { isAskUserQuestionTool } from '../../../shared/agent-question-answered-intent'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import type { AgentHookAuthorityEvidence, EnrichedAgentHookEventPayload } from './server-types'
import {
  isClaudePermissionResult,
  hasSameClaudePermissionOwner,
  isMatchingClaudePermissionResult
} from '../../../shared/agent-hook-listener/providers/claude-permission-poll'
import {
  isClaudePermissionReplay,
  matchesRetainedClaudePermission
} from '../../../shared/agent-hook-listener/claude-permission-replay'

export function canApplyClaudePermissionResult(
  previous: AgentHookEventPayload | undefined,
  incoming: AgentHookEventPayload,
  commitments: readonly AgentHookAuthorityEvidence[],
  revoked: WeakSet<AgentHookAuthorityEvidence>
): boolean {
  if (incoming.claudePermissionResolved !== true) {
    return true
  }
  if (!previous) {
    return incoming.connectionId !== null && isClaudePermissionResult(incoming)
  }
  if (
    previous.payload.state === 'waiting' &&
    incoming.claudePermissionResults &&
    isClaudePermissionReplay(incoming)
  ) {
    return matchesRetainedClaudePermission(
      previous,
      incoming,
      retainedPermissionOwner(previous, commitments, revoked)
    )
  }
  return isMatchingClaudePermissionResult(
    previous,
    incoming,
    retainedPermissionOwner(previous, commitments, revoked)
  )
}

export function admitClaudePermissionEvidence<T extends AgentHookEventPayload>(
  previous: AgentHookEventPayload | undefined,
  incoming: T,
  commitments: readonly AgentHookAuthorityEvidence[],
  revoked: WeakSet<AgentHookAuthorityEvidence>
): T | undefined {
  const owned =
    isClaudePermissionReplay(incoming) &&
    (!previous ||
      hasSameClaudePermissionOwner(
        previous,
        incoming,
        retainedPermissionOwner(previous, commitments, revoked)
      ))
  // Unrelated facts cannot suppress ordinary hooks or borrow an owner during presence folding.
  const admitted =
    !incoming.claudePermissionResults || owned
      ? incoming
      : { ...incoming, claudePermissionResults: undefined }
  return canApplyClaudePermissionResult(previous, admitted, commitments, revoked)
    ? admitted
    : undefined
}

function retainedPermissionOwner(
  previous: AgentHookEventPayload,
  commitments: readonly AgentHookAuthorityEvidence[],
  revoked: WeakSet<AgentHookAuthorityEvidence>
): string | undefined {
  // Live ingress refreshes mutable authority; restart proof uses the frozen disk commitment.
  return previous.restoredUnconfirmed
    ? commitments.find(
        (entry) =>
          entry.paneKey === previous.paneKey &&
          entry.connectionId === previous.connectionId &&
          entry.worktreeId === previous.worktreeId &&
          entry.tabId === previous.tabId &&
          !revoked.has(entry)
      )?.launchTokenHash
    : undefined
}

/** The shell fact a Claude row stores beside its `mainAgent`; restart seeds a settled main agent only
 *  when it reads `false`. The listener restates it on every event it produces; any other write keeps
 *  the previous fact only while `mainAgent` is unchanged, since the fact was observed with that one. */
export function pairedClaudeNonAgentWork(
  previous: EnrichedAgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): boolean | undefined {
  if (next.claudeRunningNonAgentTask !== undefined) {
    return next.claudeRunningNonAgentTask
  }
  return previous && mainAgentStatusEqual(previous.payload.mainAgent, next.payload.mainAgent)
    ? previous.claudeRunningNonAgentTask
    : undefined
}

/** A child's permission prompt stays visible over the main agent's own progress, but the row must
 *  still carry that progress: restart seeds the main agent from it, and a stale `done` would let the
 *  children's drain settle a row whose main agent is working. Returns `previous` when nothing changed,
 *  and keeps `previous.payload` when only the unpublished shell fact did. */
export function withHeldChildWaitMainAgent(
  previous: EnrichedAgentHookEventPayload,
  next: AgentHookEventPayload
): EnrichedAgentHookEventPayload {
  const mainAgent = next.payload.mainAgent
  if (!previous.toolAgentId || !mainAgent) {
    return previous
  }
  const runningNonAgentTask = pairedClaudeNonAgentWork(previous, next)
  const mainAgentChanged = !mainAgentStatusEqual(previous.payload.mainAgent, mainAgent)
  const pendingWakeup = next.payload.claudeTaskWakeupPending
  const wakeupChanged = pendingWakeup !== previous.payload.claudeTaskWakeupPending
  if (
    !mainAgentChanged &&
    !wakeupChanged &&
    runningNonAgentTask === previous.claudeRunningNonAgentTask
  ) {
    return previous
  }
  const { claudeRunningNonAgentTask: _unpaired, ...unpaired } = previous
  return {
    ...unpaired,
    ...(runningNonAgentTask !== undefined
      ? { claudeRunningNonAgentTask: runningNonAgentTask }
      : {}),
    payload:
      mainAgentChanged || wakeupChanged
        ? { ...previous.payload, mainAgent, claudeTaskWakeupPending: pendingWakeup }
        : previous.payload
  }
}

export function shouldKeepClaudePermissionVisible(
  previous: EnrichedAgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): boolean {
  if (previous?.restoredUnconfirmed) {
    return false
  }
  if (
    previous?.payload.agentType !== 'claude' ||
    previous.payload.state !== 'waiting' ||
    previous.hookEventName !== 'PermissionRequest' ||
    next.payload.agentType !== 'claude' ||
    next.payload.state !== 'working'
  ) {
    return false
  }
  if (next.hasExplicitPrompt === true) {
    return false
  }
  if (
    isMatchingClaudePermissionResult(previous, next) ||
    matchesRetainedClaudePermission(previous, next)
  ) {
    return false
  }
  if (isClaudePermissionOwningChildEnding(previous, next)) {
    return false
  }
  if (isClaudePermissionResumingApprovedTool(previous, next)) {
    return false
  }
  // Why: only real permission requests stay sticky; newer Claude reports AskUserQuestion as a PermissionRequest, so tool name (not event) decides.
  if (isAskUserQuestionTool(previous.payload.toolName)) {
    return false
  }
  return true
}

function isClaudePermissionOwningChildEnding(
  previous: EnrichedAgentHookEventPayload,
  next: AgentHookEventPayload
): boolean {
  const ownerId = previous.toolAgentId?.trim()
  if (!ownerId) {
    return false
  }
  if (isClaudeChildTurnEndEvent(next.hookEventName, next.toolAgentId)) {
    return ownerId === next.toolAgentId?.trim()
  }
  return (
    next.hookEventName === 'TeammateIdle' &&
    next.teammateName !== undefined &&
    claudeTeammateIdMatchesName(ownerId, next.teammateName)
  )
}

function isClaudePermissionResumingApprovedTool(
  previous: EnrichedAgentHookEventPayload,
  next: AgentHookEventPayload
): boolean {
  const previousToolUseId = previous.toolUseId?.trim() || undefined
  const nextToolUseId = next.toolUseId?.trim() || undefined
  const previousAgentId = previous.toolAgentId?.trim() || undefined
  const nextAgentId = next.toolAgentId?.trim() || undefined
  const hasAgentId = previousAgentId !== undefined || nextAgentId !== undefined
  const previousAgentType = previous.toolAgentType?.trim() || undefined
  const nextAgentType = next.toolAgentType?.trim() || undefined
  const hasMatchingConcreteAgentId =
    previousAgentId !== undefined && previousAgentId === nextAgentId
  const hasSameExplicitAgentType =
    !hasAgentId && previousAgentType !== undefined && previousAgentType === nextAgentType
  const sameToolName =
    previous.payload.toolName !== undefined && previous.payload.toolName === next.payload.toolName
  const sameKnownToolInput =
    previous.payload.toolInput !== undefined &&
    previous.payload.toolInput === next.payload.toolInput
  const sameUnknownInputFromConcreteAgent =
    hasMatchingConcreteAgentId &&
    previous.payload.toolInput === undefined &&
    next.payload.toolInput === undefined
  const hasMatchingToolUseId =
    previousToolUseId !== undefined && previousToolUseId === nextToolUseId
  const hasConflictingToolUseId =
    previousToolUseId !== undefined &&
    nextToolUseId !== undefined &&
    previousToolUseId !== nextToolUseId
  const sameUnknownInputFromToolUseId =
    hasMatchingToolUseId &&
    previous.payload.toolInput === undefined &&
    next.payload.toolInput === undefined

  // Failure events clear display fields, so only the exact request and owner can settle the wait.
  if (next.hookEventName === 'PostToolUseFailure') {
    return (
      hasMatchingToolUseId && previousAgentId === nextAgentId && previousAgentType === nextAgentType
    )
  }

  return (
    (next.hookEventName === 'PreToolUse' || next.hookEventName === 'PostToolUse') &&
    nextToolUseId !== undefined &&
    !hasConflictingToolUseId &&
    // Why: subagents share agent_type, so a concrete agent id (or the preserved PostToolUse tool_use_id) is the safest resume signal.
    (hasMatchingConcreteAgentId || hasSameExplicitAgentType || hasMatchingToolUseId) &&
    sameToolName &&
    (sameKnownToolInput || sameUnknownInputFromConcreteAgent || sameUnknownInputFromToolUseId)
  )
}

export {
  attachClaudePermissionToolUseId,
  shouldInheritClaudeToolUseIdForPermission
} from '../../../shared/agent-hook-listener/claude-permission-identity'
