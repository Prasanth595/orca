// Why: the pane's completion waits for its children. Pi uses witnessed lifecycle
// events; OMP can recover missed starts from its positively scoped native registry.

import type { PiAgentKind } from '../../shared/pi-agent-kind'
import {
  AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH,
  AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH,
  AGENT_STATUS_MAX_SUBAGENTS,
  AGENT_STATUS_TOOL_NAME_MAX_LENGTH,
  AGENT_TYPE_MAX_LENGTH
} from '../../shared/agent-status-types'

// Module scope: post() reads the roster when a body is built. Native delivery is
// fenced after failed/incomplete enumeration rather than renewing cached child proof.
export function getPiSubagentSnapshotSourceLines(): string[] {
  return [
    'type SubagentDetail = { agentType?: string; description?: string; startedAt: number; workflow?: boolean; parent?: string; registration?: object }',
    'type SubagentRoster = { active: Set<string>; exited?: Set<string>; details?: Map<string, SubagentDetail>; waiting: boolean; ownsPane?: boolean; runGeneration?: number; endedRunGeneration?: number; completionPostedGeneration?: number; parked?: Map<string, Map<string, SubagentDetail>>; onEvent?: (event: unknown, forcedStatus?: string) => void; listener?: (event: unknown) => void; onRunnerExit?: (event: unknown) => void; runnerExitListener?: (event: unknown) => void; runnerExitCheck?: NodeJS.Timeout | null; onRunnerExitSettled?: () => void; ompRegistryObserver?: OmpRegistryObservation }',
    // Why: interpolated, not re-typed, so the extension cap cannot drift from the host's.
    `const MAX_SUBAGENT_SNAPSHOT = ${AGENT_STATUS_MAX_SUBAGENTS}`,
    'let subagentRoster: SubagentRoster | null = null',
    '',
    `const OMP_STATUS_TEXT_LIMIT = ${AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH}`,
    `const OMP_STATUS_INPUT_LIMIT = ${AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH}`,
    `const OMP_STATUS_TOOL_LIMIT = ${AGENT_STATUS_TOOL_NAME_MAX_LENGTH}`,
    `const OMP_STATUS_ROLE_LIMIT = ${AGENT_TYPE_MAX_LENGTH}`,
    ...String.raw`
type OmpRootStatus = { state: 'working' | 'blocked' | 'waiting' | 'done'; prompt?: string; tool_name?: string; tool_input?: unknown; role?: 'assistant'; text?: string; session_boundary?: true; input_pending?: boolean }
type OmpNativeManager = { getSessionId?: () => unknown; getSessionFile?: () => unknown }
type OmpNativeSession = { sessionManager?: OmpNativeManager; isStreaming?: boolean; hasPendingAsyncWork?: () => boolean }
type OmpNativeRef = { id: string; displayName?: string; kind: string; parentId?: string; status: string; session?: OmpNativeSession | null; sessionFile?: string | null; createdAt?: number; history?: { agent?: string }; lifecycle?: { acceptedAt?: number; terminalAt?: number } }
type OmpNativeRegistry = { list: () => OmpNativeRef[]; get: (id: string) => OmpNativeRef | undefined; onChange: (handler: (event: { type?: string; ref?: OmpNativeRef }) => void) => (() => void); isRunning?: (ref: OmpNativeRef) => boolean }
type OmpRegistryApi = { pi?: { MAIN_AGENT_ID?: unknown; AgentRegistry?: { global?: () => unknown } } }
type OmpRegistryContext = { agent?: { id?: unknown; kind?: unknown }; agentKind?: unknown; sessionManager?: OmpNativeManager }
type OmpRootEvent = { prompt?: unknown; toolName?: unknown; input?: unknown; args?: unknown; reason?: unknown; message?: { role?: unknown; content?: unknown }; willContinue?: boolean }
type OmpRegistryObservation = { owner: object; roster: SubagentRoster; registry: OmpNativeRegistry; root: OmpNativeRef; manager: OmpNativeManager; sessionId: string; sessionFile: string; readonly scopeInstance: string; readonly scopeOrder: number; status: OmpRootStatus; identityBoundaryPending: boolean; approvalDetails?: { tool_name?: string; tool_input?: string }; questionToolName?: string; stopped: boolean; verified: boolean; pending: boolean; readUnavailable: boolean; rootExecuting: boolean; rootBaselinePending: boolean; dirty: boolean; unsubscribe?: () => void; changeTimer: NodeJS.Timeout | null; refreshTimer: NodeJS.Timeout | null }
let ompRegistryObservation: OmpRegistryObservation | null = null

function isOmpNativeSessionExecuting(session: OmpNativeSession | null | undefined): boolean {
  return session?.isStreaming === true || (typeof session?.hasPendingAsyncWork === 'function' && session.hasPendingAsyncWork() === true)
}

function isOmpNativeRegistry(registry: unknown): registry is OmpNativeRegistry {
  return typeof registry === 'object' && registry !== null &&
    'list' in registry && typeof registry.list === 'function' &&
    'get' in registry && typeof registry.get === 'function' &&
    'onChange' in registry && typeof registry.onChange === 'function'
}

function getOmpNativeRegistry(api: OmpRegistryApi): OmpNativeRegistry | null {
  if (!isOmpRuntime()) return null
  try {
    const Registry = api?.pi?.AgentRegistry
    if (typeof Registry?.global !== 'function') return null
    const registry = Registry.global()
    return isOmpNativeRegistry(registry) ? registry : null
  } catch { return null }
}

function getOmpRegistryRootRef(api: OmpRegistryApi, registry: OmpNativeRegistry, ctx: OmpRegistryContext): OmpNativeRef | null {
  if (!isOmpRuntime() || !ctx?.sessionManager) return null
  const kind = ctx.agent?.kind ?? ctx.agentKind
  if (kind !== undefined && kind !== 'main') return null
  const id = ctx.agent?.id ?? api?.pi?.MAIN_AGENT_ID
  if (typeof id !== 'string' || !id) return null
  try {
    const ref = registry.get(id)
    return ref?.kind === 'main' && ref.session?.sessionManager === ctx.sessionManager ? ref : null
  } catch { return null }
}

function isOmpRegistryObserved(): boolean {
  const observation = ompRegistryObservation
  return isOmpRuntime() && !!observation && typeof observation.unsubscribe === 'function' && !observation.stopped && observation.roster === subagentRoster
}

// Unknown native membership holds completion but is never published as fresh evidence.
function isOmpRegistryPending(): boolean {
  return isOmpRegistryObserved() && ompRegistryObservation?.pending === true
}

// Failed enumeration and positively obsolete ownership cannot renew cached proof.
// Ordinary 200ms coalescing alone does not invalidate the last verified read.
function isOmpRegistryReadUnavailable(): boolean {
  return isOmpRuntime() && (subagentRoster?.ownsPane === false || (isOmpRegistryObserved() && ompRegistryObservation?.readUnavailable === true))
}

function ompRegistrySnapshotMetadata(hookEventName?: string): Record<string, unknown> {
  const observation = ompRegistryObservation
  if (hookEventName !== 'subagents_update' || !isOmpRegistryObserved() || !observation?.verified) return {}
  return { omp_status: { ...observation.status, ...(observation.identityBoundaryPending ? { session_boundary: true } : {}) } }
}

// A turn can start before the coalesced first snapshot reaches Orca. Keep the
// separate identity proof until that identity's authoritative snapshot is delivered.
function acknowledgeOmpRegistrySnapshot(metadata: Record<string, unknown>): void {
  const observation = ompRegistryObservation
  if (!isOmpRegistryObserved() || !observation || observation.roster.ownsPane !== true || observation.roster.ompRegistryObserver !== observation ||
      typeof metadata.session_id !== 'string' || !metadata.session_id || typeof metadata.session_file !== 'string' || !metadata.session_file ||
      metadata.session_id !== observation.sessionId || metadata.session_file !== observation.sessionFile ||
      metadata.omp_scope_instance !== observation.scopeInstance || metadata.omp_scope_order !== observation.scopeOrder) return
  try {
    if (observation.registry.get(observation.root.id) !== observation.root || observation.root.session?.sessionManager !== observation.manager ||
        observation.manager.getSessionId?.() !== observation.sessionId || observation.manager.getSessionFile?.() !== observation.sessionFile) return
  } catch { return }
  observation.identityBoundaryPending = false
}

function retireOmpRegistryObservation(observation: OmpRegistryObservation): void {
  observation.stopped = true
  observation.pending = false
  observation.readUnavailable = false
  observation.approvalDetails = undefined
  if (observation.changeTimer !== null) clearTimeout(observation.changeTimer)
  if (observation.refreshTimer !== null) clearTimeout(observation.refreshTimer)
  observation.changeTimer = null
  observation.refreshTimer = null
  try { observation.unsubscribe?.() } catch {}
  observation.unsubscribe = undefined
  if (observation.roster.ompRegistryObserver === observation) observation.roster.ompRegistryObserver = undefined
  if (ompRegistryObservation === observation) ompRegistryObservation = null
}
`
      .trim()
      .split('\n'),
    '',
    // Why: an exited runner is already gone, and a pi-subagents workflow run is the lead
    // coordinating children that post their own rows; both still hold the pane.
    'function isVisibleSubagent(roster: SubagentRoster, id: string): boolean {',
    '  return roster.active.has(id) && !roster.exited?.has(id) && roster.details?.get(id)?.workflow !== true',
    '}',
    '',
    'function subagentPayload(hookEventName?: string): Record<string, unknown> {',
    '  if (!subagentRoster) return {}',
    '  const subagents: Record<string, unknown>[] = []',
    '  for (const id of subagentRoster.active) {',
    '    if (!isVisibleSubagent(subagentRoster, id)) continue',
    '    const detail = subagentRoster.details?.get(id)',
    "    subagents.push({ id, state: 'working', startedAt: detail?.startedAt ?? 0, ...(detail?.agentType ? { agentType: detail.agentType } : {}), ...(detail?.description ? { description: detail.description } : {}) })",
    '    if (subagents.length >= MAX_SUBAGENT_SNAPSHOT) break',
    '  }',
    '  const verifiedNative = isOmpRegistryObserved() && ompRegistryObservation?.verified === true',
    '  return { ...(subagents.length > 0 || verifiedNative ? { subagents } : {}), ...ompRegistrySnapshotMetadata(hookEventName) }',
    '}',
    ''
  ]
}

// The run state (children, the hold, the turn counters) has to outlive a registration: Pi hands
// each one a fresh `pi.events` and evaluates this module again on /reload, so only globalThis
// survives there. OMP and Prime keep one bus for the session.
export function getPiSubagentRosterSetupSourceLines(kind: PiAgentKind): string[] {
  return [
    '  const piEventBus = (pi as { events?: { __orcaPiSubagents?: SubagentRoster; __orcaPiSubagentsHeard?: boolean; __orcaPiRunnerExitsHeard?: boolean; on?: (name: string, handler: (event: unknown) => void) => void } }).events',
    kind === 'pi'
      ? '  const runStateHome: { __orcaPiSubagents?: SubagentRoster } | undefined = isOmpRuntime() ? piEventBus : (globalThis as { __orcaPiSubagents?: SubagentRoster })'
      : '  const runStateHome: { __orcaPiSubagents?: SubagentRoster } | undefined = piEventBus',
    // Why: a roster an older in-process build left on this bus is adopted, with the subscriptions it made.
    '  const busRoster = piEventBus?.__orcaPiSubagents',
    '  const lifecycleState: SubagentRoster = busRoster ?? runStateHome?.__orcaPiSubagents ?? { active: new Set<string>(), waiting: false }',
    '  if (runStateHome) runStateHome.__orcaPiSubagents = lifecycleState',
    // Why: optional on the shared roster so one created by an older in-process build gains them on /reload.
    '  const subagentDetails = (lifecycleState.details ??= new Map<string, SubagentDetail>())',
    // Why: completion is a per-RUN fact. A sibling extension (the memory reminder is one) can
    // start the next run from inside its own agent_settled handler, so this extension sees that
    // run's agent_start BEFORE its own agent_settled for the run that just ended; a boolean
    // "already posted" latch would eat the newer run's completion.
    '  lifecycleState.runGeneration ??= 0',
    '  lifecycleState.endedRunGeneration ??= 0',
    '  lifecycleState.completionPostedGeneration ??= -1',
    // Why: a native child can load first. Only a proven root callback binds the pane's
    // module roster; each bus may listen for the capability-absent lifecycle fallback.
    '  if (!isOmpRuntime()) subagentRoster ??= lifecycleState',
    '  const ownsPaneRoster = isOmpRuntime() || subagentRoster === lifecycleState',
    // Tells the children this registration saw start from the ones a /reload handed it.
    '  const registration = {}',
    '  function resetSubagentRoster(): void {',
    '    clearRunnerExitCheck()',
    '    lifecycleState.active.clear()',
    '    lifecycleState.exited?.clear()',
    '    subagentDetails.clear()',
    '    lifecycleState.waiting = false',
    '  }',
    // Why: one subscription per bus object; Pi drops a replaced registration's own.
    '  if (ownsPaneRoster && piEventBus?.on && !piEventBus.__orcaPiSubagentsHeard && !busRoster?.listener) {',
    '    piEventBus.__orcaPiSubagentsHeard = true',
    "    piEventBus.on('task:subagent:lifecycle', (event: unknown) => lifecycleState.onEvent?.(event))",
    "    piEventBus.on('subagent:async-started', (event: unknown) => lifecycleState.onEvent?.(event, 'started'))",
    "    piEventBus.on('subagent:async-complete', (event: unknown) => lifecycleState.onEvent?.(event, 'completed'))",
    '  }',
    '  if (ownsPaneRoster && piEventBus?.on && !piEventBus.__orcaPiRunnerExitsHeard && !busRoster?.runnerExitListener) {',
    '    piEventBus.__orcaPiRunnerExitsHeard = true',
    "    piEventBus.on('subagent:process-terminal', (event: unknown) => lifecycleState.onRunnerExit?.(event))",
    '  }'
  ]
}

// Expects post() and postAgentEndOnce() from the handler scope; the latter prunes
// exited runners, then returns whether it settled the pane.
export function getPiSubagentRosterEventSourceLines(): string[] {
  return [
    // Why: a run that reports its own completion does so ~150ms after its runner exits;
    // the grace lets that path (and the wake turn it triggers) settle the pane first.
    '  const RUNNER_EXIT_GRACE_MS = 2000',
    '  function clearRunnerExitCheck(): void {',
    '    if (lifecycleState.runnerExitCheck != null) clearTimeout(lifecycleState.runnerExitCheck)',
    '    lifecycleState.runnerExitCheck = null',
    '  }',
    '  function forgetSubagent(id: string): void {',
    '    lifecycleState.active.delete(id)',
    '    lifecycleState.exited?.delete(id)',
    '    subagentDetails.delete(id)',
    '  }',
    // Why: a child can end with no lead event to carry it; a queued post already reads the new roster.
    '  function postSubagentsUpdate(): void {',
    "    if (!hasQueuedPost()) post('subagents_update')",
    '  }',
    "  const readLabel = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined",
    '  lifecycleState.onEvent = (event: unknown, forcedStatus?: string): void => {',
    "    if (!event || typeof event !== 'object') return",
    '    const record = event as { id?: unknown; runId?: unknown; agent?: unknown; description?: unknown; workflowKey?: unknown; mode?: unknown; parentWorkflowRunId?: unknown }',
    "    const id = typeof record.id === 'string' && record.id ? record.id : typeof record.runId === 'string' ? record.runId : ''",
    '    const status = forcedStatus ?? (event as { status?: unknown }).status',
    '    if (!id) return',
    '    if (isOmpRuntime() && (!lifecycleState.ownsPane || isOmpRegistryObserved())) return',
    "    if (status === 'started') {",
    '      lifecycleState.active.add(id)',
    // Why: pi-subagents redacts task prompts, so only the agent name, OMP's short label and a
    // workflow child's step key are shown. The key tells apart siblings that share an agent.
    "      if (!subagentDetails.has(id)) subagentDetails.set(id, { agentType: readLabel(record.agent), description: readLabel(record.description) ?? readLabel(record.workflowKey), startedAt: Date.now(), workflow: record.mode === 'workflow', parent: readLabel(record.parentWorkflowRunId), registration })",
    // Why: Pi re-opens only a posted completion; an earlier child must leave the idle check intact.
    '      if (!isTurnInFlight() && (isOmpRuntime() || lifecycleState.runGeneration === 0 || lifecycleState.completionPostedGeneration === lifecycleState.runGeneration)) {',
    '        lifecycleState.waiting = true',
    '        lifecycleState.completionPostedGeneration = -1',
    '      }',
    "      post('agent_start')",
    '      return',
    '    }',
    "    if (status !== 'completed' && status !== 'failed' && status !== 'aborted') return",
    '    let wasVisible = isVisibleSubagent(lifecycleState, id)',
    '    forgetSubagent(id)',
    // Why: Pi drops the runner-exit events of runs started before a /reload, so a finished run
    // takes the children it launched back then with it.
    '    for (const [childId, detail] of subagentDetails) {',
    '      if (detail.parent !== id || detail.registration === registration) continue',
    '      wasVisible ||= isVisibleSubagent(lifecycleState, childId)',
    '      forgetSubagent(childId)',
    '    }',
    '    if (lifecycleState.waiting && postAgentEndOnce()) return',
    '    if (wasVisible) postSubagentsUpdate()',
    '  }',
    // Why: awaited workflow children never get subagent:async-complete; their runner
    // exiting is the only end signal pi-subagents publishes for them.
    '  lifecycleState.onRunnerExitSettled = (): void => {',
    '    if (lifecycleState.waiting) postAgentEndOnce()',
    '  }',
    '  lifecycleState.onRunnerExit = (event: unknown): void => {',
    '    if (isOmpRuntime() && (!lifecycleState.ownsPane || isOmpRegistryObserved())) return',
    "    const runId = event && typeof event === 'object' ? (event as { runId?: unknown }).runId : undefined",
    "    if (typeof runId !== 'string' || !lifecycleState.active.has(runId)) return",
    '    if (!lifecycleState.exited) lifecycleState.exited = new Set<string>()',
    '    const wasVisible = isVisibleSubagent(lifecycleState, runId)',
    '    lifecycleState.exited.add(runId)',
    '    if (wasVisible) postSubagentsUpdate()',
    '    if (!lifecycleState.waiting) return',
    '    clearRunnerExitCheck()',
    '    lifecycleState.runnerExitCheck = setTimeout(() => {',
    '      lifecycleState.runnerExitCheck = null',
    '      lifecycleState.onRunnerExitSettled?.()',
    '    }, RUNNER_EXIT_GRACE_MS)',
    "    if (typeof lifecycleState.runnerExitCheck.unref === 'function') lifecycleState.runnerExitCheck.unref()",
    '  }'
  ]
}
