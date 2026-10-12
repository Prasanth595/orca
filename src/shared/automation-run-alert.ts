import type { ExecutionHostId } from './execution-host'
import type { AutomationRun } from './automations-types'
import type { NotificationDispatchRequest } from './notification-settings-types'
import type { StableAutomationCatalogRef } from './automation-owner-ref'

export type AutomationRunNavigation = {
  automationId: string
  runId: string
  hostId?: ExecutionHostId
  catalogRef?: StableAutomationCatalogRef
}

export type AutomationRunAlert = AutomationRunNavigation & {
  executionHostId?: ExecutionHostId
  title: string
  message: string
  status: 'failed' | 'needs_attention'
  workspaceId: string | null
  paneKey: string | null
  createdAt: number
}

export function automationRunAlert(run: AutomationRun): AutomationRunAlert | null {
  if (run.status !== 'dispatch_failed' && !run.result) {
    return null
  }
  const message =
    run.status === 'dispatch_failed'
      ? run.error || run.result?.message
      : run.result?.message || run.error
  return {
    automationId: run.automationId,
    runId: run.id,
    title: run.title,
    message: message || 'The automation could not complete.',
    ...(run.reportHostId ? { executionHostId: run.reportHostId } : {}),
    status: run.status === 'dispatch_failed' ? 'failed' : (run.result?.status ?? 'failed'),
    workspaceId: run.workspaceId,
    paneKey: run.terminalPaneKey,
    createdAt:
      run.inboxAlert &&
      run.inboxAlert.status === (run.status === 'dispatch_failed' ? 'failed' : run.result?.status)
        ? run.inboxAlert.createdAt
        : Date.now()
  }
}

export function newAutomationRunAlert(
  previous: AutomationRun | null | undefined,
  run: AutomationRun
): AutomationRunAlert | null {
  if (previous?.status === 'dispatch_failed') {
    return null
  }
  const alert = automationRunAlert(run)
  return alert && previous?.result?.status !== alert.status ? alert : null
}

export function automationRunNotificationRequest(
  alert: AutomationRunAlert
): NotificationDispatchRequest {
  const key = `automation:${alert.automationId}:${alert.runId}`
  return {
    source: 'agent-task-complete',
    notificationId: key,
    attentionKey: `${key}:${alert.status}`,
    automationRun: alert,
    worktreeId: alert.workspaceId ?? undefined,
    agentState: alert.status === 'failed' ? 'done' : 'waiting',
    agentTurnOutcome: alert.status === 'failed' ? 'failure' : undefined,
    mobileDeliveredByHost: true
  }
}
