import { useAppStore } from '@/store'
import {
  deliverAgentAttentionNotification,
  readAgentAttentionNotificationSound
} from '@/attention/agent-attention-notification-delivery'
import {
  automationRunNotificationRequest,
  type AutomationRunNavigation
} from '../../../shared/automation-run-alert'
import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { notificationSourceForOwner } from '../../../shared/notification-source'
import type { AutomationsChangedPayload } from '../../../shared/runtime-client-events'
import type {
  StableAutomationAuthorityRef,
  StableAutomationCatalogRef
} from '../../../shared/automation-owner-ref'

export function openAutomationRunNotification(target: AutomationRunNavigation): void {
  const state = useAppStore.getState()
  if (target.catalogRef) {
    state.setAutomationHostFilter({ kind: 'host', host: target.catalogRef })
  }
  state.setPendingAutomationRunNavigation(target)
  state.openAutomationsPage()
}

export function deliverAutomationRunAlert(
  payload: AutomationsChangedPayload & { environmentId?: string | null }
): void {
  if (!payload.alert) {
    return
  }
  const state = useAppStore.getState()
  const environmentId = payload.environmentId
  const hostId: ExecutionHostId = environmentId
    ? toRuntimeExecutionHostId(environmentId)
    : payload.selector?.kind === 'ssh'
      ? toSshExecutionHostId(payload.selector.targetId)
      : 'local'
  const executionHostId = environmentId
    ? toRuntimeExecutionHostId(environmentId)
    : (payload.alert.executionHostId ?? hostId)
  const authority: StableAutomationAuthorityRef = environmentId
    ? { kind: 'runtime', environmentId }
    : { kind: 'desktop' }
  const selector = payload.selector ?? { kind: 'self' as const }
  const catalogRef: StableAutomationCatalogRef =
    selector.kind === 'orphan'
      ? { authority, selector: { kind: 'orphan' } }
      : { authority, selector }
  const alert = {
    ...payload.alert,
    hostId,
    catalogRef
  }
  if (alert.workspaceId && !environmentId) {
    state.markWorktreeUnread(alert.workspaceId)
    if (alert.paneKey) {
      state.markAgentCompletionPaneUnread(alert.paneKey, 'agent-completion')
    }
  }
  deliverAgentAttentionNotification(
    {
      ...automationRunNotificationRequest(alert),
      notificationSourceId: notificationSourceForOwner(
        { executionHostId, runtimeEnvironmentId: environmentId ?? null },
        state
      ),
      isActiveWorktree: alert.workspaceId === state.activeWorktreeId
    },
    readAgentAttentionNotificationSound(state.settings ?? {})
  )
}
