import type { AutomationRunStatus } from './automations-types'

export const MAX_AUTOMATION_RESULT_MESSAGE_LENGTH = 2_000
export type AutomationRunResultStatus = 'failed' | 'needs_attention'
export type AutomationRunResult = {
  status: AutomationRunResultStatus
  message: string
  reportedAt: number
}
export type AutomationRunResultReport = {
  runId: string
  token: string
  status: AutomationRunResultStatus
  message: string
}
export type AutomationRunDisplayStatus = AutomationRunStatus | AutomationRunResultStatus

export function getAutomationRunDisplayStatus(
  status: AutomationRunStatus,
  result?: AutomationRunResultStatus | null
): AutomationRunDisplayStatus {
  return status === 'dispatch_failed' ? status : (result ?? status)
}

export function normalizeAutomationRunResult(value: unknown): AutomationRunResult | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('status' in value) ||
    !('message' in value) ||
    !('reportedAt' in value)
  ) {
    return undefined
  }
  if (
    (value.status !== 'failed' && value.status !== 'needs_attention') ||
    typeof value.message !== 'string' ||
    !value.message.trim() ||
    value.message.length > MAX_AUTOMATION_RESULT_MESSAGE_LENGTH ||
    typeof value.reportedAt !== 'number' ||
    !Number.isFinite(value.reportedAt)
  ) {
    return undefined
  }
  return { status: value.status, message: value.message.trim(), reportedAt: value.reportedAt }
}
