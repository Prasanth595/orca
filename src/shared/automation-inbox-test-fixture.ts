import type { AutomationInboxEntry } from './automation-inbox'

export function makeAutomationInboxEntry(
  alert: Partial<AutomationInboxEntry['alert']> = {},
  catalogKey = 'host:desktop:self'
): AutomationInboxEntry {
  return {
    alert: {
      automationId: 'auto-1',
      runId: 'run-1',
      title: 'Nightly run 1',
      message: 'Login expired',
      status: 'failed',
      createdAt: 10,
      workspaceId: null,
      paneKey: null,
      ...alert
    },
    catalogKey,
    read: false,
    dismissed: false,
    interactionAt: 0
  }
}
