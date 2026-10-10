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
  title: string
  message: string
  status: 'failed' | 'needs_attention'
  workspaceId: string | null
  paneKey: string | null
  createdAt: number
}

export function automationRunAlert(run: AutomationRun): AutomationRunAlert | null {
  if (run.status !== 'dispatch_failed') {
    return null
  }
  return {
    automationId: run.automationId,
    runId: run.id,
    title: run.title,
    message: run.error || 'The automation could not complete.',
    status: 'failed',
    workspaceId: run.workspaceId,
    paneKey: run.terminalPaneKey,
    createdAt: Date.now()
  }
}

export function automationRunNotificationRequest(
  alert: AutomationRunAlert
): NotificationDispatchRequest {
  const key = `automation:${alert.automationId}:${alert.runId}`
  return {
    source: 'agent-task-complete',
    notificationId: key,
    attentionKey: key,
    automationRun: alert,
    worktreeId: alert.workspaceId ?? undefined,
    agentState: alert.status === 'failed' ? 'done' : 'waiting',
    agentTurnOutcome: alert.status === 'failed' ? 'failure' : undefined,
    mobileDeliveredByHost: true
  }
}
