/**
 * Human-readable automation output for the CLI.
 *
 * The host lines come from the authority's own projection, never from the
 * stored `executionTarget*` fields: a target that was removed — or removed and
 * re-registered under the same id — leaves those fields untouched, so printing
 * them alone would render a dead host identically to a healthy one and leave
 * `orca automations show` unable to complete the recovery it is named in.
 */

import type { Automation, AutomationRun, AutomationRunsPage } from '../shared/automations-types'
import type { AutomationListItem } from '../shared/automation-list-scope'
import type { AutomationHealth } from '../shared/automation-health'
import type { AutomationOwnerPrecondition } from '../shared/automation-owner-precondition'
import { getAutomationLegacyRepoId } from '../shared/automation-run-identity'
import { formatAutomationPrecheckTimeout } from '../shared/automation-precheck'
import { formatAutomationSchedule } from '../shared/automation-schedules'

export type AutomationListPayload = {
  automations: Automation[]
  /** Present only when the authority qualifies its rows; an older host sends none. */
  items?: AutomationListItem[]
}

export type AutomationShowPayload = {
  automation: Automation
  /** Present only when the authority can project an owner; an older host sends none. */
  owner?: AutomationOwnerPrecondition
}

const ORPHAN_HOST_LABEL = 'orphan (no host can run this automation)'

function formatOwnerSelector(selector: AutomationOwnerPrecondition['selector']): string {
  if (selector.kind === 'ssh') {
    return `ssh:${selector.targetId} (generation ${selector.targetGeneration})`
  }
  return selector.kind === 'orphan' ? ORPHAN_HOST_LABEL : 'self'
}

function formatListItemSelector(item: AutomationListItem): string {
  const selector = item.selector
  if (selector.kind === 'ssh') {
    return `ssh:${selector.targetId} (generation ${selector.targetGeneration})`
  }
  return selector.kind === 'orphan' ? `orphan — ${selector.issue}` : 'self'
}

export function formatAutomationList(result: AutomationListPayload): string {
  if (result.automations.length === 0) {
    return 'No automations found.'
  }
  const hosts = new Map(result.items?.map((item) => [item.automationId, item]) ?? [])
  return result.automations
    .map((automation) => {
      const status = automation.enabled ? 'enabled' : 'disabled'
      const item = hosts.get(automation.id)
      const host = item ? `\nhost: ${formatListItemSelector(item)}` : ''
      return `${automation.id}  ${automation.name}  ${automation.agentId}  ${status}\n${formatAutomationSchedule(automation.rrule)}  next: ${new Date(automation.nextRunAt).toISOString()}${host}`
    })
    .join('\n\n')
}

export function formatAutomationHealth(result: { automations: AutomationHealth[] }): string {
  if (result.automations.length === 0) {
    return 'No automations found.'
  }
  return result.automations
    .map((health) => {
      const next = new Date(health.nextRunAt).toISOString()
      const overdue = health.overdueDurationMs > 0 ? `  overdueMs: ${health.overdueDurationMs}` : ''
      const remediation = health.remediation ? `\nremediation: ${health.remediation}` : ''
      const semantic = health.semanticEvaluationMode
        ? `  jev: ${health.lastSemanticChoice ?? 'not_recorded'}${health.lastSemanticConfidence === null ? '' : `@${health.lastSemanticConfidence}`}`
        : ''
      return `${health.automationId}  ${health.name}  ${health.verdict}\nnext: ${next}  last: ${health.lastProcessStatus ?? 'none'}  workflow: ${health.lastWorkflowOutcome ?? 'not_recorded'}${semantic}  consecutiveFailures: ${health.consecutiveFailures}${overdue}${remediation}`
    })
    .join('\n\n')
}

export function formatAutomationShow(result: AutomationShowPayload): string {
  const automation = result.automation
  const runContext = automation.runContext ?? null
  const projectLines = runContext
    ? [
        `runProjectId: ${runContext.projectId}`,
        `runHostId: ${runContext.hostId}`,
        `projectHostSetupId: ${runContext.projectHostSetupId}`,
        `runRepoId: ${runContext.repoId}`,
        `runPath: ${runContext.path}`,
        `legacyRepoId: ${getAutomationLegacyRepoId(automation)}`
      ]
    : [`legacyRepoId: ${getAutomationLegacyRepoId(automation)}`]
  return [
    `id: ${automation.id}`,
    `name: ${automation.name}`,
    `provider: ${automation.agentId}`,
    ...(automation.extraAgentArgs ? [`extraAgentArgs: ${automation.extraAgentArgs}`] : []),
    `enabled: ${automation.enabled}`,
    `schedule: ${formatAutomationSchedule(automation.rrule)}`,
    `rrule: ${automation.rrule}`,
    `precheck: ${
      automation.precheck
        ? `${automation.precheck.command} (timeout ${formatAutomationPrecheckTimeout(
            automation.precheck.timeoutSeconds
          )})`
        : 'none'
    }`,
    `nextRunAt: ${new Date(automation.nextRunAt).toISOString()}`,
    ...projectLines,
    `workspaceMode: ${automation.workspaceMode}`,
    `workspaceId: ${automation.workspaceId ?? 'null'}`,
    `baseBranch: ${automation.baseBranch ?? 'null'}`,
    `reuseSession: ${automation.reuseSession}`,
    `workflowReceiptRequired: ${automation.workflowReceiptRequired ?? false}`,
    `semanticEvaluation: ${
      automation.semanticEvaluation
        ? `${automation.semanticEvaluation.evaluator}:${automation.semanticEvaluation.mode} (${automation.semanticEvaluation.rubricPath})`
        : 'none'
    }`,
    `target: ${automation.executionTargetType}:${automation.executionTargetId}`,
    // Omitted rather than guessed: a host that reports no owner has none to report.
    ...(result.owner ? [`host: ${formatOwnerSelector(result.owner.selector)}`] : []),
    `prompt: ${automation.prompt}`
  ].join('\n')
}

export function formatAutomationRemoved(result: { removed: boolean; id: string }): string {
  return result.removed
    ? `Removed automation ${result.id}.`
    : `Automation ${result.id} not removed.`
}

export function formatAutomationRun(result: { run: AutomationRun }): string {
  return [
    `id: ${result.run.id}`,
    `automationId: ${result.run.automationId}`,
    `title: ${result.run.title}`,
    `status: ${result.run.status}`,
    `trigger: ${result.run.trigger}`,
    `scheduledFor: ${new Date(result.run.scheduledFor).toISOString()}`,
    `workspaceId: ${result.run.workspaceId ?? 'null'}`,
    `precheck: ${formatAutomationRunPrecheck(result.run)}`,
    `workflowOutcome: ${result.run.workflowReceipt?.outcome ?? 'not_recorded'}`,
    `workflowSummary: ${result.run.workflowReceipt?.summary ?? 'null'}`,
    `semanticChoice: ${result.run.semanticEvaluationReceipt?.choice ?? 'not_recorded'}`,
    `semanticConfidence: ${result.run.semanticEvaluationReceipt?.confidence ?? 'null'}`,
    `semanticRubric: ${
      result.run.semanticEvaluationReceipt
        ? `${result.run.semanticEvaluationReceipt.rubricId}@${result.run.semanticEvaluationReceipt.rubricVersion}`
        : 'null'
    }`,
    `error: ${result.run.error ?? 'null'}`
  ].join('\n')
}

function formatAutomationRunPrecheck(run: AutomationRun): string {
  const result = run.precheckResult
  if (!result) {
    return 'none'
  }
  const outcome = result.timedOut
    ? 'timed out'
    : result.error
      ? 'error'
      : `exit ${result.exitCode ?? 'unknown'}`
  const output = result.stderr.trim() || result.stdout.trim()
  return output ? `${outcome}; ${output}` : outcome
}

export function formatAutomationRuns(
  result: AutomationRunsPage | { runs: AutomationRun[] }
): string {
  if (result.runs.length === 0) {
    return 'No automation runs found.'
  }
  const output = result.runs
    .map(
      (run) =>
        `${run.id}  ${run.automationId}  ${run.status}  ${run.trigger}  ${new Date(run.scheduledFor).toISOString()}\n${run.title}${run.workflowReceipt ? `\nworkflow: ${run.workflowReceipt.outcome}${run.workflowReceipt.summary ? `; ${run.workflowReceipt.summary}` : ''}` : ''}${run.semanticEvaluationReceipt ? `\njev: ${run.semanticEvaluationReceipt.choice}@${run.semanticEvaluationReceipt.confidence}` : ''}${run.precheckResult ? `\nprecheck: ${formatAutomationRunPrecheck(run)}` : ''}${run.error ? `\nerror: ${run.error}` : ''}`
    )
    .join('\n\n')
  return 'nextCursor' in result && result.nextCursor
    ? `${output}\n\nnextCursor: ${result.nextCursor}`
    : output
}
