import type { AgentHookEventPayload } from './listener-event'

export function shouldInheritClaudeToolUseIdForPermission(
  previous: AgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): boolean {
  if (
    previous?.restoredUnconfirmed ||
    previous?.payload.agentType !== 'claude' ||
    previous.payload.state !== 'working' ||
    previous.hookEventName !== 'PreToolUse' ||
    typeof previous.toolUseId !== 'string' ||
    previous.toolUseId.trim().length === 0 ||
    next.payload.agentType !== 'claude' ||
    next.payload.state !== 'waiting' ||
    next.hookEventName !== 'PermissionRequest' ||
    (previous.launchToken !== undefined && previous.launchToken !== next.launchToken) ||
    (previous.providerSession !== undefined &&
      previous.providerSession.id !== next.providerSession?.id) ||
    next.toolUseId !== undefined
  ) {
    return false
  }
  const sameKnownToolInput =
    previous.payload.toolInput !== undefined &&
    previous.payload.toolInput === next.payload.toolInput
  const sameUnknownToolInput =
    previous.payload.toolInput === undefined && next.payload.toolInput === undefined
  if (
    previous.toolAgentId !== next.toolAgentId ||
    previous.toolAgentType !== next.toolAgentType ||
    previous.payload.toolName === undefined ||
    previous.payload.toolName !== next.payload.toolName ||
    (!sameKnownToolInput && !sameUnknownToolInput)
  ) {
    return false
  }
  return true
}

export function attachClaudePermissionToolUseId(
  previous: AgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): AgentHookEventPayload {
  const inheritedToolUseId = previous?.toolUseId
  if (
    !shouldInheritClaudeToolUseIdForPermission(previous, next) ||
    typeof inheritedToolUseId !== 'string'
  ) {
    return next
  }
  return {
    ...next,
    // Why: Claude emits PermissionRequest without tool_use_id, then PostToolUse carries the original PreToolUse id.
    toolUseId: inheritedToolUseId,
    claudePermissionToolUseIdInferred: true
  }
}
