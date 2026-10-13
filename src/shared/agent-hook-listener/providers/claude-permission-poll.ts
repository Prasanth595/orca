import type { AgentHookEventPayload } from '../listener-event'
import type { HookListenerState } from '../listener-state'
import { isAskUserQuestionTool } from '../../agent-question-answered-intent'
import { readClaudePermissionResult } from '../claude-permission-result'
import { clearClaudePendingToolWait, setClaudeMainAgentTurnState } from './claude-roster-state'
import { isSameAgentProcess } from '../../agent-process-presence'
import { probeAgentProcessPresence } from '../../agent-process-presence-probe'
import { launchTokenHash } from '../../agent-hook-spool'
import { structuralValuesEqualIgnoringUndefined } from '../../structural-value-equality'

export function canPollClaudePermission(
  event: AgentHookEventPayload,
  allowRestoredLocal = false
): boolean {
  const restored = isRestoredLocalPermission(event, allowRestoredLocal)
  return (
    event.source === 'claude' &&
    event.connectionId === null &&
    event.payload.agentType === 'claude' &&
    event.payload.state === 'waiting' &&
    event.hookEventName === 'PermissionRequest' &&
    !isAskUserQuestionTool(event.payload.toolName) &&
    (!event.restoredUnconfirmed || restored) &&
    !event.isReplay &&
    !event.providerSessionOnly &&
    !event.agentPresence?.ended &&
    event.agentPresence?.process !== undefined &&
    (!event.claudePermissionToolUseIdInferred || Boolean(event.payload.toolName)) &&
    Boolean(
      (event.launchToken || restored) &&
      event.toolUseId &&
      event.providerSession?.id &&
      event.providerSession.transcriptPath
    )
  )
}

function isRestoredLocalPermission(event: AgentHookEventPayload, allowed: boolean): boolean {
  return (
    allowed &&
    event.restoredUnconfirmed === true &&
    event.connectionId === null &&
    event.launchToken === undefined
  )
}

/** Seed only after the owning server verifies the frozen local authority commitment. */
export function seedRestoredClaudePermission(
  state: HookListenerState,
  event: AgentHookEventPayload
): void {
  if (!canPollClaudePermission(event, true) || !event.restoredUnconfirmed) {
    return
  }
  const previous = state.claudeLeadStateByPaneKey.get(event.paneKey)
  if (previous?.state === 'waiting') {
    return
  }
  const main = event.payload.mainAgent
  const before =
    event.toolAgentId &&
    main &&
    main.state !== 'waiting' &&
    (main.state !== 'done' || event.claudeRunningNonAgentTask === false)
      ? main
      : { state: 'working' as const, stateStartedAt: main?.stateStartedAt ?? Date.now() }
  setClaudeMainAgentTurnState(state, event.paneKey, {
    state: 'waiting',
    waitingAgentId: event.toolAgentId,
    stateBeforeWait: before
  })
}

/** Runs on the execution host; a disconnected client never reads a remote transcript locally. */
export async function pollClaudePermissionResult<T extends AgentHookEventPayload>(
  state: HookListenerState,
  original: T,
  apply: (event: T) => T | undefined,
  canRecoverRestored?: () => boolean
): Promise<T | undefined> {
  const session = original.providerSession
  const toolUseId = original.toolUseId
  const lead = state.claudeLeadStateByPaneKey.get(original.paneKey)
  if (
    !canPollClaudePermission(original, canRecoverRestored?.() === true) ||
    state.lastStatusByPaneKey.get(original.paneKey) !== original ||
    lead?.state !== 'waiting' ||
    lead.waitingAgentId !== original.toolAgentId ||
    !session?.transcriptPath ||
    !toolUseId ||
    !readClaudePermissionResult(session.transcriptPath, {
      sessionId: session.id,
      toolUseId,
      agentId: original.toolAgentId,
      ...((original.claudePermissionToolUseIdInferred || original.restoredUnconfirmed) &&
      original.payload.toolName
        ? { inferredTool: { name: original.payload.toolName, input: original.payload.toolInput } }
        : {})
    })
  ) {
    return original
  }
  const verdict = await probeAgentProcessPresence(original.agentPresence?.process)
  if (
    verdict !== 'live' ||
    (original.restoredUnconfirmed && canRecoverRestored?.() !== true) ||
    state.lastStatusByPaneKey.get(original.paneKey) !== original ||
    state.claudeLeadStateByPaneKey.get(original.paneKey) !== lead ||
    !readClaudePermissionResult(session.transcriptPath, {
      sessionId: session.id,
      toolUseId,
      agentId: original.toolAgentId,
      ...((original.claudePermissionToolUseIdInferred || original.restoredUnconfirmed) &&
      original.payload.toolName
        ? { inferredTool: { name: original.payload.toolName, input: original.payload.toolInput } }
        : {})
    })
  ) {
    return original
  }
  const paneKey = original.paneKey
  const tool = state.lastToolByPaneKey.get(paneKey)
  const tasks = state.claudeLaunchedBackgroundTasksByPaneKey.get(paneKey)
  const savedTasks = tasks && new Map([...tasks].map(([id, task]) => [id, { ...task }]))
  try {
    const restored = clearClaudePendingToolWait(state, paneKey)
    const candidate: T = {
      ...original,
      hookEventName: undefined,
      hasExplicitPrompt: undefined,
      claudePermissionResolved: true,
      hostEvidenceObservedAt: Date.now(),
      payload: {
        ...original.payload,
        ...restored,
        toolName: undefined,
        toolInput: undefined,
        interactivePrompt: undefined
      }
    }
    return (
      apply(candidate) ??
      (state.lastStatusByPaneKey.get(paneKey) === original ? original : undefined)
    )
  } finally {
    // Keep the pending row and its listener caches consistent if admission refuses the result.
    if (state.lastStatusByPaneKey.get(paneKey) === original) {
      state.claudeLeadStateByPaneKey.set(paneKey, lead)
      if (tool) {
        state.lastToolByPaneKey.set(paneKey, tool)
      } else {
        state.lastToolByPaneKey.delete(paneKey)
      }
      if (tasks && savedTasks) {
        tasks.clear()
        for (const [id, task] of savedTasks) {
          tasks.set(id, task)
        }
        state.claudeLaunchedBackgroundTasksByPaneKey.set(paneKey, tasks)
      }
    }
  }
}

export function isClaudePermissionResult(
  event: AgentHookEventPayload,
  allowRestoredLocal = false
): boolean {
  const restored = isRestoredLocalPermission(event, allowRestoredLocal)
  return (
    event.claudePermissionResolved === true &&
    event.source === 'claude' &&
    event.payload.agentType === 'claude' &&
    event.payload.state !== 'waiting' &&
    !event.hookEventName &&
    !event.hasExplicitPrompt &&
    !event.providerSessionOnly &&
    (!event.restoredUnconfirmed || restored) &&
    !event.agentPresence?.ended &&
    event.agentPresence?.agent === 'claude' &&
    event.agentPresence.process !== undefined &&
    Boolean(
      (event.launchToken || restored) &&
      event.toolUseId &&
      event.providerSession?.id &&
      event.providerSession.transcriptPath
    )
  )
}

export function isMatchingClaudePermissionResult(
  previous: AgentHookEventPayload,
  next: AgentHookEventPayload,
  retainedLaunchTokenHash?: string
): boolean {
  const pendingRequest =
    previous.payload.state === 'waiting' &&
    previous.hookEventName === 'PermissionRequest' &&
    !isAskUserQuestionTool(previous.payload.toolName)
  return (
    isClaudePermissionResult(next) &&
    (pendingRequest || isSettledPermissionRestatement(previous, next)) &&
    hasSameClaudePermissionOwner(previous, next, retainedLaunchTokenHash) &&
    Boolean(previous.toolUseId) &&
    previous.toolUseId === next.toolUseId &&
    previous.toolAgentId === next.toolAgentId &&
    previous.toolAgentType === next.toolAgentType
  )
}

export function hasSameClaudePermissionOwner(
  previous: AgentHookEventPayload,
  next: AgentHookEventPayload,
  retainedLaunchTokenHash?: string
): boolean {
  const restoredOwner =
    previous.restoredUnconfirmed === true &&
    next.connectionId !== null &&
    retainedLaunchTokenHash !== undefined &&
    launchTokenHash(next.launchToken) === retainedLaunchTokenHash
  return (
    hasSameClaudePermissionIdentity(previous, next) &&
    !next.restoredUnconfirmed &&
    (restoredOwner ||
      (!previous.restoredUnconfirmed &&
        Boolean(previous.launchToken) &&
        (next.connectionId === null || Boolean(previous.hostTurnRevision)) &&
        previous.launchToken === next.launchToken &&
        previous.hostTurnRevision === next.hostTurnRevision)) &&
    Boolean(next.launchToken)
  )
}

export function hasSameClaudePermissionIdentity(
  previous: AgentHookEventPayload,
  next: AgentHookEventPayload
): boolean {
  const previousProcess = previous.agentPresence?.process
  const nextProcess = next.agentPresence?.process
  return (
    previousProcess !== undefined &&
    nextProcess !== undefined &&
    !previous.agentPresence?.ended &&
    !next.agentPresence?.ended &&
    next.source === 'claude' &&
    next.payload.agentType === 'claude' &&
    previous.payload.agentType === 'claude' &&
    isSameAgentProcess(previousProcess, nextProcess) &&
    Boolean(previous.providerSession?.id && next.providerSession?.transcriptPath) &&
    previous.paneKey === next.paneKey &&
    previous.worktreeId === next.worktreeId &&
    previous.tabId === next.tabId &&
    previous.connectionId === next.connectionId &&
    previous.providerSession?.key === next.providerSession?.key &&
    previous.providerSession?.id === next.providerSession?.id &&
    previous.providerSession?.transcriptPath === next.providerSession?.transcriptPath
  )
}

function isSettledPermissionRestatement(
  previous: AgentHookEventPayload,
  next: AgentHookEventPayload
): boolean {
  const {
    state: oldState,
    claudeTaskWakeupPending: oldWakeup,
    turnCompletedAt: oldCompletedAt,
    ...oldPayload
  } = previous.payload
  const {
    state: nextState,
    claudeTaskWakeupPending: nextWakeup,
    turnCompletedAt: nextCompletedAt,
    ...nextPayload
  } = next.payload
  // A cached proof may expire its notification lease, but cannot restore older progress.
  return (
    !previous.hookEventName &&
    oldState !== 'waiting' &&
    !(oldState === 'done' && nextState !== 'done') &&
    (nextWakeup === undefined || nextWakeup === oldWakeup) &&
    (oldCompletedAt === undefined || nextCompletedAt === oldCompletedAt) &&
    structuralValuesEqualIgnoringUndefined(oldPayload, nextPayload)
  )
}
