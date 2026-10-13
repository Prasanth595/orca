import type { AgentHookEventPayload } from './listener-event'
import { isAskUserQuestionTool } from '../agent-question-answered-intent'
import { isRecord } from '../agent-status-child-work-value-guards'
import { hasSameClaudePermissionOwner } from './providers/claude-permission-poll'

export const MAX_RETAINED_CLAUDE_PERMISSION_RESULTS = 16
export type ClaudePermissionResultIdentity = {
  toolUseId: string
  toolAgentId?: string
  toolAgentType?: string
}

export function readClaudePermissionResults(
  value: unknown
): ClaudePermissionResultIdentity[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_RETAINED_CLAUDE_PERMISSION_RESULTS
  ) {
    return undefined
  }
  const results: ClaudePermissionResultIdentity[] = []
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && id.trim().length > 0 && id.length <= 256
  for (const row of value) {
    if (
      !isRecord(row) ||
      !validId(row.toolUseId) ||
      (row.toolAgentId !== undefined && !validId(row.toolAgentId)) ||
      (row.toolAgentType !== undefined && !validId(row.toolAgentType))
    ) {
      return undefined
    }
    results.push({
      toolUseId: row.toolUseId.trim(),
      ...(row.toolAgentId !== undefined ? { toolAgentId: row.toolAgentId.trim() } : {}),
      ...(row.toolAgentType !== undefined ? { toolAgentType: row.toolAgentType.trim() } : {})
    })
  }
  return results
}

export function isClaudePermissionReplay(event: AgentHookEventPayload): boolean {
  return (
    event.isReplay === true &&
    event.connectionId !== null &&
    event.source === 'claude' &&
    event.payload.agentType === 'claude' &&
    event.payload.state !== 'waiting' &&
    !event.providerSessionOnly &&
    !event.restoredUnconfirmed &&
    !event.agentPresence?.ended &&
    event.agentPresence?.agent === 'claude' &&
    event.agentPresence.process !== undefined &&
    Boolean(
      event.launchToken && event.providerSession?.id && event.providerSession.transcriptPath
    ) &&
    readClaudePermissionResults(event.claudePermissionResults) !== undefined
  )
}

export function matchesRetainedClaudePermission(
  previous: AgentHookEventPayload,
  next: AgentHookEventPayload,
  retainedLaunchTokenHash?: string
): boolean {
  return (
    isClaudePermissionReplay(next) &&
    previous.payload.state === 'waiting' &&
    previous.hookEventName === 'PermissionRequest' &&
    !isAskUserQuestionTool(previous.payload.toolName) &&
    hasSameClaudePermissionOwner(previous, next, retainedLaunchTokenHash) &&
    next.claudePermissionResults?.some(
      (result) =>
        result.toolUseId === previous.toolUseId &&
        result.toolAgentId === previous.toolAgentId &&
        result.toolAgentType === previous.toolAgentType
    ) === true
  )
}
