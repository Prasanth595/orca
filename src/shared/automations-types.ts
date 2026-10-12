import type { TuiAgent } from './tui-agent'
import type { SetupDecision } from './worktree/create-types'
import type { TaskSourceContext, WorkspaceRunContext } from './task-source-context'
import type { AutomationRunStatus } from './automation-run-state'
import type {
  AutomationSemanticEvaluationConfig,
  AutomationSemanticEvaluationReceipt
} from './automation-semantic-evaluation-types'

export { isFinalAutomationRunStatus } from './automation-run-state'
export type { AutomationRunQuery, AutomationRunStatus } from './automation-run-state'
export type {
  AutomationSemanticEvaluationChoice,
  AutomationSemanticEvaluationConfig,
  AutomationSemanticEvaluationMode,
  AutomationSemanticEvaluationReceipt,
  AutomationSemanticEvaluationResult
} from './automation-semantic-evaluation-types'
export type {
  ExternalAutomationAction,
  ExternalAutomationActionInput,
  ExternalAutomationCreateInput,
  ExternalAutomationJob,
  ExternalAutomationManager,
  ExternalAutomationManagerStatus,
  ExternalAutomationProvider,
  ExternalAutomationRun,
  ExternalAutomationRunsInput,
  ExternalAutomationRunsPage,
  ExternalAutomationRunStatus,
  ExternalAutomationTarget,
  ExternalAutomationUpdateInput
} from './external-automations-types'

export type AutomationWorkspaceMode = 'existing' | 'new_per_run'
export type AutomationExecutionTargetType = 'local' | 'ssh'
export type AutomationSchedulerOwner = 'local_host_service' | 'ssh_bridge' | 'remote_host_service'
export type AutomationMissedRunPolicy = 'run_once_within_grace'
export type AutomationRunTrigger = 'scheduled' | 'manual'
export type AutomationWorkflowOutcome = 'passed' | 'failed' | 'blocked'

export type AutomationWorkflowReceipt = {
  outcome: AutomationWorkflowOutcome
  summary: string | null
  recordedAt: number
  source: 'agent'
}

export type AutomationSchedulePreset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'
export type AutomationRunUsageProvider = 'claude' | 'codex'
export type AutomationRunUsageStatus = 'known' | 'unavailable'
export type AutomationRunUsageAttribution = 'provider_session_time_window'
export type AutomationRunUsageUnavailableReason =
  | 'run_not_finished'
  | 'provider_unsupported'
  | 'remote_usage_unavailable'
  | 'usage_not_enabled'
  | 'scan_failed'
  | 'no_matching_session'
  | 'ambiguous_session'

export type AutomationRunUsage = {
  status: AutomationRunUsageStatus
  provider: AutomationRunUsageProvider | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  reasoningOutputTokens: number | null
  totalTokens: number | null
  estimatedCostUsd: number | null
  estimatedCostSource: 'api_equivalent' | null
  providerSessionId: string | null
  attribution: AutomationRunUsageAttribution | null
  collectedAt: number
  unavailableReason: AutomationRunUsageUnavailableReason | null
  unavailableMessage: string | null
}

export type AutomationRunOutputSnapshot = {
  format: 'plain_text'
  content: string
  capturedAt: number
  truncated: boolean
}

export type AutomationPrecheck = {
  command: string
  timeoutSeconds: number
}

export type AutomationPrecheckResult = {
  command: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  error: string | null
  startedAt: number
  completedAt: number
}

export type Automation = {
  id: string
  /** Optional client request key used to make cross-authority creates retry-safe. */
  creationKey?: string
  name: string
  prompt: string
  precheck: AutomationPrecheck | null
  agentId: TuiAgent
  /** Saved text appended to the host's default agent Arguments on each fresh run; absent means none. */
  extraAgentArgs?: string
  /** Why: runContext carries the logical project + host setup identity for
   *  multi-host projects; projectId remains only as the legacy repo-id storage
   *  field for pre-host-context automations.
   *  @deprecated Use runContext.projectId/runContext.repoId or
   *  getAutomationRunRepoId(). */
  runContext?: WorkspaceRunContext | null
  /** Why: task/provider data can come from a different host/account than the
   *  workspace run target, so automations persist it separately. */
  sourceContext?: TaskSourceContext | null
  /** @deprecated Legacy repo-id compatibility field. New code should persist
   *  runContext and use getAutomationRunRepoId() for fallback reads. */
  projectId: string
  executionTargetType: AutomationExecutionTargetType
  executionTargetId: string
  /** Why: pins the SSH registration incarnation this record was attached to, so a
   *  removed-and-re-added target reusing the id can't silently adopt it. Absent on
   *  local records, on legacy records, and on orphans whose target is gone. */
  executionTargetGeneration?: number
  schedulerOwner: AutomationSchedulerOwner
  workspaceMode: AutomationWorkspaceMode
  workspaceId: string | null
  baseBranch: string | null
  setupDecision?: SetupDecision
  reuseSession: boolean
  timezone: string
  rrule: string
  dtstart: number
  enabled: boolean
  nextRunAt: number
  lastRunAt?: number
  missedRunPolicy: AutomationMissedRunPolicy
  missedRunGraceMinutes: number
  /** Opt-in semantic success contract. Legacy schedules default to process-only health. */
  workflowReceiptRequired?: boolean
  /** Optional independent Jev judgment over a versioned rubric and run evidence. */
  semanticEvaluation?: AutomationSemanticEvaluationConfig | null
  createdAt: number
  updatedAt: number
}

export type AutomationRun = {
  id: string
  automationId: string
  runContext?: WorkspaceRunContext | null
  sourceContext?: TaskSourceContext | null
  title: string
  scheduledFor: number
  status: AutomationRunStatus
  trigger: AutomationRunTrigger
  workspaceId: string | null
  /** Why: run history must remain understandable after the backing workspace
   *  is deleted and its live metadata is gone. */
  workspaceDisplayName?: string | null
  sessionKind: 'terminal'
  chatSessionId: string | null
  terminalSessionId: string | null
  /** Why: a terminal tab can later point at a different pane/PTY. Automation
   *  run reopening must target the pane that actually executed the run. */
  terminalPaneKey: string | null
  terminalPtyId: string | null
  outputSnapshot: AutomationRunOutputSnapshot | null
  precheckResult: AutomationPrecheckResult | null
  usage: AutomationRunUsage | null
  workflowReceipt?: AutomationWorkflowReceipt | null
  /** Snapshot of the semantic contract used when this run was created. */
  semanticEvaluation?: AutomationSemanticEvaluationConfig | null
  semanticEvaluationReceipt?: AutomationSemanticEvaluationReceipt | null
  error: string | null
  startedAt: number | null
  dispatchedAt: number | null
  createdAt: number
  /** Why: run titles must stay unique once retention prunes old runs, so the
   *  number can no longer be derived from how many runs are currently kept. */
  runNumber?: number
  /** Why: a target that cannot resolve refuses every occurrence, so consecutive
   *  identical refusals fold into this record instead of one row each. Counts the
   *  occurrences the record stands for; absent means one. */
  occurrenceCount?: number
  /** `scheduledFor` of the most recently folded occurrence; absent until one folds. */
  lastOccurrenceAt?: number
}

/** A bounded history response; older hosts may continue returning `runs` only. */
export type AutomationRunsPage = {
  runs: AutomationRun[]
  nextCursor: string | null
}

export type AutomationCreateInput = {
  /** Optional idempotency key; repeated creates return the original record. */
  creationKey?: string
  name: string
  prompt: string
  precheck?: AutomationPrecheck | null
  agentId: TuiAgent
  /** Empty or whitespace means no extras. */
  extraAgentArgs?: string
  runContext?: WorkspaceRunContext | null
  sourceContext?: TaskSourceContext | null
  /** @deprecated Legacy repo-id compatibility field required for older stored
   *  automations and clients. Pair it with runContext for new writes. */
  projectId: string
  workspaceMode: AutomationWorkspaceMode
  workspaceId?: string | null
  baseBranch?: string | null
  setupDecision?: SetupDecision
  reuseSession?: boolean
  timezone: string
  rrule: string
  dtstart: number
  enabled?: boolean
  missedRunGraceMinutes?: number
  workflowReceiptRequired?: boolean
  semanticEvaluation?: AutomationSemanticEvaluationConfig | null
}

export type AutomationUpdateInput = Partial<
  Pick<
    Automation,
    | 'name'
    | 'prompt'
    | 'precheck'
    | 'agentId'
    | 'extraAgentArgs'
    | 'runContext'
    | 'sourceContext'
    | 'projectId'
    | 'workspaceMode'
    | 'workspaceId'
    | 'baseBranch'
    | 'setupDecision'
    | 'reuseSession'
    | 'timezone'
    | 'rrule'
    | 'dtstart'
    | 'enabled'
    | 'missedRunGraceMinutes'
    | 'workflowReceiptRequired'
    | 'semanticEvaluation'
  >
>

export type AutomationDispatchRequest = {
  automation: Automation
  run: AutomationRun
  dispatchToken: string
}

export type AutomationDispatchResult = {
  runId: string
  status: AutomationRunStatus
  workspaceId?: string | null
  workspaceDisplayName?: string | null
  terminalSessionId?: string | null
  terminalPaneKey?: string | null
  terminalPtyId?: string | null
  outputSnapshot?: AutomationRunOutputSnapshot | null
  precheckResult?: AutomationPrecheckResult | null
  usage?: AutomationRunUsage | null
  error?: string | null
}
