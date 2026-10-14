import type { Store } from '../persistence'
import type { AutomationRunWriter } from './automation-run-writer'
import type { AutomationRun } from '../../shared/automations-types'
import {
  normalizeAutomationRunResult,
  type AutomationRunResultReport
} from '../../shared/automation-run-result'

export async function reportAutomationRunResult(
  store: Pick<Store, 'listAutomationRuns'>,
  runs: AutomationRunWriter,
  input: AutomationRunResultReport
): Promise<AutomationRun> {
  const run = store.listAutomationRuns().find((entry) => entry.id === input.runId)
  if (!run) {
    throw new Error('Automation run not found.')
  }
  if (!run.reportToken || run.reportToken !== input.token) {
    throw new Error('The report token does not belong to this automation run.')
  }
  if (run.status !== 'dispatching' && run.status !== 'dispatched' && run.status !== 'completed') {
    throw new Error('This automation run cannot accept an agent report.')
  }
  const result = normalizeAutomationRunResult({
    status: input.status,
    message: input.message,
    reportedAt: Date.now()
  })
  if (!result) {
    throw new Error(
      'A valid result status and non-empty message of at most 2000 characters are required.'
    )
  }
  if (
    run.result &&
    (run.result.status !== result.status || run.result.message !== result.message)
  ) {
    throw new Error('This automation run already reported a result.')
  }
  return runs.updateRun({
    runId: run.id,
    status: run.status,
    result: run.result ?? result,
    error: run.error
  })
}
