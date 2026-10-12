import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationSemanticEvaluationChoice,
  AutomationSemanticEvaluationMode,
  AutomationWorkflowOutcome
} from './automations-types'

export type AutomationHealthVerdict = 'healthy' | 'disabled' | 'overdue' | 'failed' | 'unverifiable'

export type AutomationHealth = {
  automationId: string
  name: string
  enabled: boolean
  verdict: AutomationHealthVerdict
  nextRunAt: number
  overdueDurationMs: number
  lastRunId: string | null
  lastProcessStatus: AutomationRunStatus | null
  lastWorkflowOutcome: AutomationWorkflowOutcome | null
  semanticEvaluationMode: AutomationSemanticEvaluationMode | null
  lastSemanticChoice: AutomationSemanticEvaluationChoice | null
  lastSemanticConfidence: number | null
  consecutiveFailures: number
  historyAvailable: boolean
  remediation: string | null
}

const FAILED_RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  'dispatch_failed',
  'skipped_precheck',
  'skipped_missed',
  'skipped_unavailable',
  'skipped_needs_interactive_auth'
])

function isFailedRun(run: AutomationRun): boolean {
  return FAILED_RUN_STATUSES.has(run.status)
}

export function deriveAutomationHealth(input: {
  automation: Automation
  runs: readonly AutomationRun[]
  now: number
  ownerIssue?: string
  historyAvailable?: boolean
}): AutomationHealth {
  const { automation, runs, now, ownerIssue } = input
  const historyAvailable = input.historyAvailable ?? true
  const latest = runs[0] ?? null
  // Why: an edited schedule must not retroactively change the contract of an existing run.
  // Legacy runs fall back to the current automation configuration.
  const semanticEvaluation = latest?.semanticEvaluation ?? automation.semanticEvaluation ?? null
  const firstSuccess = runs.findIndex((run) => !isFailedRun(run))
  const consecutiveFailures = firstSuccess === -1 ? runs.length : firstSuccess
  const overdueDurationMs = automation.enabled ? Math.max(0, now - automation.nextRunAt) : 0

  let verdict: AutomationHealthVerdict = 'healthy'
  let remediation: string | null = null
  if (!automation.enabled) {
    verdict = 'disabled'
  } else if (ownerIssue || !historyAvailable) {
    verdict = 'unverifiable'
    remediation = ownerIssue
      ? 'Repair or retarget the automation owner before relying on this schedule.'
      : 'Bring the automation owner online and retry the history check.'
  } else if (latest && isFailedRun(latest)) {
    verdict = 'failed'
    remediation = 'Inspect the latest run and resolve its process failure before the next schedule.'
  } else if (
    latest?.workflowReceipt?.outcome === 'failed' ||
    latest?.workflowReceipt?.outcome === 'blocked'
  ) {
    verdict = 'failed'
    remediation = 'Inspect the latest workflow receipt and resolve its semantic failure.'
  } else if (
    automation.workflowReceiptRequired &&
    latest?.status === 'completed' &&
    !latest.workflowReceipt
  ) {
    verdict = 'unverifiable'
    remediation = 'Record a workflow receipt for the latest completed run.'
  } else if (
    semanticEvaluation?.mode === 'enforced' &&
    latest?.status === 'completed' &&
    !latest.semanticEvaluationReceipt
  ) {
    verdict = 'unverifiable'
    remediation = 'Run the configured Jev evaluation for the latest completed run.'
  } else if (
    semanticEvaluation?.mode === 'enforced' &&
    latest?.semanticEvaluationReceipt &&
    latest.semanticEvaluationReceipt.mode !== semanticEvaluation.mode
  ) {
    verdict = 'unverifiable'
    remediation = 'Rerun Jev using the semantic evaluation mode captured for this run.'
  } else if (
    semanticEvaluation?.mode === 'enforced' &&
    latest?.semanticEvaluationReceipt &&
    latest.semanticEvaluationReceipt.confidence < latest.semanticEvaluationReceipt.minimumConfidence
  ) {
    verdict = 'unverifiable'
    remediation = 'Review the low-confidence Jev evaluation and its evidence.'
  } else if (
    semanticEvaluation?.mode === 'enforced' &&
    latest?.semanticEvaluationReceipt?.choice === 'requirements_not_satisfied'
  ) {
    verdict = 'failed'
    remediation = 'Inspect the Jev evaluation and remediate the unmet workflow requirements.'
  } else if (
    semanticEvaluation?.mode === 'enforced' &&
    latest?.semanticEvaluationReceipt?.choice === 'insufficient_evidence'
  ) {
    verdict = 'unverifiable'
    remediation = 'Add sufficient evidence and rerun the configured Jev evaluation.'
  } else if (overdueDurationMs > 0) {
    verdict = 'overdue'
    remediation = 'Confirm the scheduler owner is running and can dispatch this automation.'
  }

  return {
    automationId: automation.id,
    name: automation.name,
    enabled: automation.enabled,
    verdict,
    nextRunAt: automation.nextRunAt,
    overdueDurationMs,
    lastRunId: latest?.id ?? null,
    lastProcessStatus: latest?.status ?? null,
    lastWorkflowOutcome: latest?.workflowReceipt?.outcome ?? null,
    semanticEvaluationMode: semanticEvaluation?.mode ?? null,
    lastSemanticChoice: latest?.semanticEvaluationReceipt?.choice ?? null,
    lastSemanticConfidence: latest?.semanticEvaluationReceipt?.confidence ?? null,
    consecutiveFailures,
    historyAvailable,
    remediation
  }
}
