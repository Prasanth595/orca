import type {
  AutomationRun,
  AutomationSemanticEvaluationResult,
  AutomationWorkflowOutcome
} from '../../../shared/automations-types'
import type { AutomationRunOperations } from './automation-run-operations'

export function recordAutomationWorkflowReceipt(
  operations: AutomationRunOperations,
  runId: string,
  outcome: AutomationWorkflowOutcome,
  summary?: string
): AutomationRun {
  const current = (operations.state.automationRuns ?? []).find((run) => run.id === runId)
  if (!current) {
    throw new Error('Automation run not found.')
  }
  const normalizedSummary = summary?.trim() || null
  if (current.workflowReceipt) {
    if (
      current.workflowReceipt.outcome === outcome &&
      current.workflowReceipt.summary === normalizedSummary
    ) {
      return current
    }
    throw new Error('Automation workflow receipt is already recorded.')
  }
  const updated: AutomationRun = {
    ...current,
    workflowReceipt: {
      outcome,
      summary: normalizedSummary,
      recordedAt: Date.now(),
      source: 'agent'
    }
  }
  operations.state.automationRuns = (operations.state.automationRuns ?? []).map((run) =>
    run.id === runId ? updated : run
  )
  operations.recordAutomationRunsMutation?.(operations.state.automationRuns)
  operations.flush()
  return updated
}

export function recordAutomationSemanticEvaluation(
  operations: AutomationRunOperations,
  runId: string,
  result: AutomationSemanticEvaluationResult
): AutomationRun {
  const current = (operations.state.automationRuns ?? []).find((run) => run.id === runId)
  if (!current) {
    throw new Error('Automation run not found.')
  }
  const configuredEvaluation =
    current.semanticEvaluation ??
    (operations.state.automations ?? []).find(
      (automation) => automation.id === current.automationId
    )?.semanticEvaluation
  if (!configuredEvaluation || configuredEvaluation.evaluator !== result.evaluator) {
    throw new Error('Automation run has no matching semantic evaluation configuration.')
  }
  if (configuredEvaluation.mode !== result.mode) {
    throw new Error('Automation semantic evaluation mode does not match the run configuration.')
  }
  if (current.semanticEvaluationReceipt) {
    const {
      recordedAt: _recordedAt,
      source: _source,
      ...existing
    } = current.semanticEvaluationReceipt
    if (JSON.stringify(existing) === JSON.stringify(result)) {
      return current
    }
    throw new Error('Automation semantic evaluation is already recorded.')
  }
  const updated: AutomationRun = {
    ...current,
    semanticEvaluationReceipt: {
      ...result,
      recordedAt: Date.now(),
      source: 'evaluator'
    }
  }
  operations.state.automationRuns = (operations.state.automationRuns ?? []).map((run) =>
    run.id === runId ? updated : run
  )
  operations.recordAutomationRunsMutation?.(operations.state.automationRuns)
  operations.flush()
  return updated
}
