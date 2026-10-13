import type {
  Automation,
  AutomationRun,
  AutomationRunsPage,
  AutomationRunStatus,
  AutomationWorkflowOutcome
} from '../../shared/automations-types'
import { deriveAutomationHealth } from '../../shared/automation-health'
import type { AutomationListItem } from '../../shared/automation-list-scope'
import type { CommandHandler } from '../dispatch'
import {
  formatAutomationHealth,
  formatAutomationRun,
  formatAutomationRuns,
  printResult,
  type AutomationShowPayload
} from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { evaluateAutomationEvidenceWithJev } from '../automation-jev-evaluator'
import { assertSemanticEvaluationSupported } from './automation-runtime-support'

function isAutomationRunStatus(value: string): value is AutomationRunStatus {
  return (
    value === 'pending' ||
    value === 'dispatching' ||
    value === 'dispatched' ||
    value === 'completed' ||
    value === 'skipped_precheck' ||
    value === 'skipped_missed' ||
    value === 'skipped_unavailable' ||
    value === 'skipped_needs_interactive_auth' ||
    value === 'dispatch_failed'
  )
}

function getAutomationRunStatusFlag(
  flags: Map<string, string | boolean>
): AutomationRunStatus | undefined {
  const status = getOptionalStringFlag(flags, 'status')
  if (status === undefined) {
    return undefined
  }
  if (!isAutomationRunStatus(status)) {
    throw new RuntimeClientError('invalid_argument', `Invalid automation run status: ${status}`)
  }
  return status
}

function getAutomationRunsSinceFlag(flags: Map<string, string | boolean>): number | undefined {
  const since = getOptionalStringFlag(flags, 'since')
  if (since === undefined) {
    return undefined
  }
  const parsed = Date.parse(since)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(since) || !Number.isFinite(parsed)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Invalid --since "${since}". Use an ISO 8601 timestamp with an offset, for example 2026-10-01T00:00:00-04:00.`
    )
  }
  return parsed
}

function getWorkflowOutcomeFlag(flags: Map<string, string | boolean>): AutomationWorkflowOutcome {
  const outcome = getRequiredStringFlag(flags, 'outcome')
  if (outcome !== 'passed' && outcome !== 'failed' && outcome !== 'blocked') {
    throw new RuntimeClientError(
      'invalid_argument',
      `Invalid workflow outcome: ${outcome}. Use passed, failed, or blocked.`
    )
  }
  return outcome
}

function getRunId(flags: Map<string, string | boolean>): string {
  const runId = getOptionalStringFlag(flags, 'run') ?? process.env.ORCA_AUTOMATION_RUN_ID
  if (!runId) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Missing automation run id. Pass it as a positional value or run from an automation agent.'
    )
  }
  return runId
}

async function getAutomationHealthRuns(
  client: Parameters<CommandHandler>[0]['client'],
  automationId: string
): Promise<AutomationRun[]> {
  const runs: AutomationRun[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  do {
    const history = await client.call<AutomationRunsPage>('automation.runs', {
      automationId,
      limit: 100,
      cursor
    })
    runs.push(...history.result.runs)
    if (runs.some((run) => run.status === 'completed')) {
      break
    }
    const nextCursor = history.result.nextCursor ?? undefined
    if (!nextCursor) {
      break
    }
    if (seenCursors.has(nextCursor)) {
      throw new RuntimeClientError('internal_error', 'Automation history returned a cursor cycle.')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor !== undefined)
  return runs
}

export const AUTOMATION_RUN_HANDLERS: Record<string, CommandHandler> = {
  'automations doctor': async ({ client, json }) => {
    const result = await client.call<{ automations: Automation[]; items?: AutomationListItem[] }>(
      'automation.list'
    )
    const items = new Map(result.result.items?.map((item) => [item.automationId, item]) ?? [])
    const now = Date.now()
    const automations = await Promise.all(
      result.result.automations.map(async (automation) => {
        const owner = items.get(automation.id)
        const ownerIssue = owner?.selector.kind === 'orphan' ? owner.selector.issue : undefined
        try {
          const runs = await getAutomationHealthRuns(client, automation.id)
          return deriveAutomationHealth({ automation, runs, now, ownerIssue })
        } catch {
          return deriveAutomationHealth({
            automation,
            runs: [],
            now,
            ownerIssue,
            historyAvailable: false
          })
        }
      })
    )
    printResult({ ...result, result: { automations } }, json, formatAutomationHealth)
  },
  'automations run-show': async ({ flags, client, json }) => {
    const result = await client.call<{ run: AutomationRun }>('automation.runShow', {
      id: getRequiredStringFlag(flags, 'id')
    })
    printResult(result, json, formatAutomationRun)
  },
  'automations receipt': async ({ flags, client, json }) => {
    const result = await client.call<{ run: AutomationRun }>('automation.recordWorkflowReceipt', {
      runId: getRunId(flags),
      outcome: getWorkflowOutcomeFlag(flags),
      summary: getOptionalStringFlag(flags, 'summary')
    })
    printResult(result, json, formatAutomationRun)
  },
  'automations jev-evaluate': async ({ flags, client, cwd, json }) => {
    const runId = getRunId(flags)
    await assertSemanticEvaluationSupported(client, undefined, true)
    const apiKey = process.env.AI_GATEWAY_API_KEY?.trim()
    if (!apiKey) {
      throw new RuntimeClientError(
        'invalid_argument',
        'AI_GATEWAY_API_KEY is required in the process environment for Jev evaluation.'
      )
    }
    const runResult = await client.call<{ run: AutomationRun }>('automation.runShow', { id: runId })
    const automationResult = await client.call<AutomationShowPayload>('automation.show', {
      id: runResult.result.run.automationId
    })
    // Why: use the contract captured for this run so later schedule edits cannot
    // silently change its rubric or enforcement mode.
    const evaluation =
      runResult.result.run.semanticEvaluation === undefined
        ? automationResult.result.automation.semanticEvaluation
        : runResult.result.run.semanticEvaluation
    if (!evaluation || evaluation.evaluator !== 'jev') {
      throw new RuntimeClientError(
        'invalid_argument',
        'This automation has no Jev evaluation configured.'
      )
    }
    const semanticResult = await evaluateAutomationEvidenceWithJev({
      cwd,
      stateFile: getRequiredStringFlag(flags, 'state-file'),
      rubricPath: evaluation.rubricPath,
      mode: evaluation.mode,
      apiKey
    })
    const result = await client.call<{ run: AutomationRun }>(
      'automation.recordSemanticEvaluation',
      { runId, result: semanticResult }
    )
    printResult(result, json, formatAutomationRun)
  },
  'automations runs': async ({ flags, client, json }) => {
    const result = await client.call<AutomationRunsPage>('automation.runs', {
      automationId: getOptionalStringFlag(flags, 'id'),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit'),
      cursor: getOptionalStringFlag(flags, 'cursor'),
      status: getAutomationRunStatusFlag(flags),
      since: getAutomationRunsSinceFlag(flags)
    })
    printResult(result, json, formatAutomationRuns)
  }
}
