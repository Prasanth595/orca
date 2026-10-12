export const MAX_AUTOMATION_INBOX_TEXT_LENGTH = 4000

export type AutomationRunInboxAlert = {
  title: string
  message: string
  status: 'failed' | 'needs_attention'
  createdAt: number
}

export function snapshotAutomationRunInboxAlert(
  alert: AutomationRunInboxAlert
): AutomationRunInboxAlert {
  return {
    title: alert.title.slice(0, MAX_AUTOMATION_INBOX_TEXT_LENGTH),
    message: alert.message.slice(0, MAX_AUTOMATION_INBOX_TEXT_LENGTH),
    status: alert.status,
    createdAt: alert.createdAt
  }
}
