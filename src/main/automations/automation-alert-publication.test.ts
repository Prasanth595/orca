import { describe, expect, it, vi } from 'vitest'
import { publishAutomationRunChange } from './automation-alert-publication'
import type { AutomationRunAlert } from '../../shared/automation-run-alert'

const alert: AutomationRunAlert = {
  automationId: 'auto-1',
  runId: 'run-1',
  title: 'Daily check run 1',
  message: 'Authentication failed',
  status: 'failed',
  workspaceId: null,
  paneKey: null,
  createdAt: 123
}
const settings = { enabled: true, agentTaskComplete: true }

describe('automation alert publication', () => {
  it('pushes a headless failure to paired phones without a workspace or renderer', () => {
    const runtime = { dispatchMobileNotification: vi.fn(), notifyAutomationsChanged: vi.fn() }
    publishAutomationRunChange(runtime, { reason: 'run', alert }, settings)
    expect(runtime.dispatchMobileNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent-task-complete',
        title: 'Daily check run 1 — failed',
        body: 'Authentication failed',
        notificationId: 'automation:auto-1:run-1',
        attentionKey: 'automation:auto-1:run-1',
        agentState: 'done'
      })
    )
    expect(runtime.notifyAutomationsChanged).toHaveBeenCalledWith({ reason: 'run', alert })
  })

  it('does not push ordinary catalog and usage changes', () => {
    const runtime = { dispatchMobileNotification: vi.fn(), notifyAutomationsChanged: vi.fn() }
    publishAutomationRunChange(runtime, { reason: 'usage' }, settings)
    expect(runtime.dispatchMobileNotification).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: false, agentTaskComplete: true },
    { enabled: true, agentTaskComplete: false }
  ])(
    'keeps disabled host notifications out of mobile push and legacy streams: %j',
    (preferences) => {
      const runtime = { dispatchMobileNotification: vi.fn(), notifyAutomationsChanged: vi.fn() }
      publishAutomationRunChange(runtime, { reason: 'run', alert }, preferences)
      expect(runtime.dispatchMobileNotification).toHaveBeenCalledWith(
        expect.objectContaining({ desktopAllowed: false })
      )
      expect(runtime.notifyAutomationsChanged).toHaveBeenCalledWith({ reason: 'run', alert })
    }
  )
})
