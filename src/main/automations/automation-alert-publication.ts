import { automationRunNotificationRequest } from '../../shared/automation-run-alert'
import type { AutomationsChangedPayload } from '../../shared/runtime-client-events'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { buildNotificationOptions } from '../ipc/notification-options'

export function publishAutomationRunChange(
  runtime: Pick<OrcaRuntimeService, 'notifyAutomationsChanged' | 'dispatchMobileNotification'>,
  payload: AutomationsChangedPayload
): void {
  if (payload.alert) {
    const request = automationRunNotificationRequest(payload.alert)
    runtime.dispatchMobileNotification({
      type: 'notification',
      source: request.source,
      ...buildNotificationOptions(request),
      worktreeId: request.worktreeId,
      notificationId: request.notificationId,
      attentionKey: request.attentionKey,
      agentState: request.agentState,
      emittedAt: payload.alert.createdAt
    })
  }
  runtime.notifyAutomationsChanged(payload)
}
