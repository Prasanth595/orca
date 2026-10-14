import type { AutomationRun } from '../../../shared/automations-types'
import type { AutomationsChangedPayload } from '../../../shared/runtime-client-events'
import { MAX_AUTOMATION_INBOX_ENTRIES } from '../../../shared/automation-inbox'
import type { AutomationChangeSelector } from '../../../shared/automation-list-scope'

export function listAutomationInbox(
  runs: readonly AutomationRun[],
  selectorFor: (automationId: string) => AutomationChangeSelector | null
): AutomationsChangedPayload[] {
  const newest: AutomationRun[] = []
  for (const run of runs) {
    if (!run.inboxAlert) {
      continue
    }
    const stamp = run.inboxAlert.createdAt
    const index = newest.findIndex((candidate) => stamp > (candidate.inboxAlert?.createdAt ?? 0))
    const position = index === -1 ? newest.length : index
    if (position >= MAX_AUTOMATION_INBOX_ENTRIES) {
      continue
    }
    newest.splice(position, 0, run)
    if (newest.length > MAX_AUTOMATION_INBOX_ENTRIES) {
      newest.pop()
    }
  }
  return newest.map((run) => ({
    selector: selectorFor(run.automationId) ?? { kind: 'orphan' },
    alert: {
      automationId: run.automationId,
      runId: run.id,
      title: run.inboxAlert?.title ?? run.title,
      message: run.inboxAlert?.message ?? '',
      status: run.inboxAlert?.status ?? 'failed',
      createdAt: run.inboxAlert?.createdAt ?? run.createdAt,
      ...(run.reportHostId ? { executionHostId: run.reportHostId } : {}),
      workspaceId: run.workspaceId,
      paneKey: run.terminalPaneKey
    }
  }))
}
