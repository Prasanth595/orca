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
import { hostStableKey } from '../../../shared/automation-owner-key'
import { normalizeAutomationInboxEntries } from '../../../shared/automation-inbox'
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

export function scopedAutomationRunAlert(
  payload: AutomationsChangedPayload & { environmentId?: string | null }
) {
  if (!payload.alert) {
    return null
  }
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
  return { alert, executionHostId }
}

export function receiveAutomationRunInbox(
  payload: AutomationsChangedPayload & { environmentId?: string | null }
): void {
  receiveAutomationRunInboxBatch([payload])
}

export function receiveAutomationRunInboxBatch(
  payloads: readonly (AutomationsChangedPayload & { environmentId?: string | null })[]
): void {
  const incoming = Object.fromEntries(
    payloads.flatMap((payload, index) => {
      const scoped = scopedAutomationRunAlert(payload)
      if (!scoped) {
        return []
      }
      const { catalogRef, ...alert } = scoped.alert
      return [
        [
          String(index),
          {
            alert,
            catalogKey: hostStableKey(catalogRef),
            read: false,
            dismissed: false,
            interactionAt: 0
          }
        ] as const
      ]
    })
  )
  useAppStore.getState().receiveAutomationInbox(normalizeAutomationInboxEntries(incoming))
}

export function deliverAutomationRunAlert(
  payload: AutomationsChangedPayload & { environmentId?: string | null }
): void {
  const scoped = scopedAutomationRunAlert(payload)
  if (!scoped) {
    return
  }
  const { alert, executionHostId } = scoped
  const state = useAppStore.getState()
  receiveAutomationRunInbox(payload)
  if (alert.workspaceId && !payload.environmentId) {
    state.markWorktreeUnread(alert.workspaceId)
    if (alert.paneKey) {
      state.markAgentCompletionPaneUnread(alert.paneKey, 'agent-completion')
    }
  }
  deliverAgentAttentionNotification(
    {
      ...automationRunNotificationRequest(alert),
      notificationSourceId: notificationSourceForOwner(
        { executionHostId, runtimeEnvironmentId: payload.environmentId ?? null },
        state
      ),
      isActiveWorktree: alert.workspaceId === state.activeWorktreeId
    },
    readAgentAttentionNotificationSound(state.settings ?? {})
  )
}
