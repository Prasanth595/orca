import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationRunAlert } from '../../../shared/automation-run-alert'

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  receiveAutomationInbox: vi.fn(),
  markWorktreeUnread: vi.fn(),
  markAgentCompletionPaneUnread: vi.fn(),
  setPendingAutomationRunNavigation: vi.fn(),
  openAutomationsPage: vi.fn(),
  setAutomationHostFilter: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      ...mocks,
      settings: {},
      activeWorktreeId: 'wt-1',
      runtimeEnvironments: [{ id: 'env-1', source: { kind: 'ssh', host: 'host' } }],
      sshTargetLabels: new Map([['ssh-1', 'Host']])
    })
  }
}))
vi.mock('@/attention/agent-attention-notification-delivery', () => ({
  deliverAgentAttentionNotification: mocks.deliver,
  readAgentAttentionNotificationSound: () => ({ customSoundId: 'system', customSoundVolume: 1 })
}))
import {
  deliverAutomationRunAlert,
  openAutomationRunNotification
} from './automation-run-alert-delivery'

const alert: AutomationRunAlert = {
  automationId: 'auto-1',
  runId: 'run-1',
  title: 'Daily run',
  message: 'Login expired',
  status: 'failed',
  workspaceId: 'wt-1',
  paneKey: 'tab-1:leaf-1',
  createdAt: 100
}

describe('automation alert delivery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses existing delivery policy and marks a local workspace unread', () => {
    deliverAutomationRunAlert({ alert, selector: { kind: 'self' } })
    expect(mocks.markWorktreeUnread).toHaveBeenCalledWith('wt-1')
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent-task-complete',
        mobileDeliveredByHost: true,
        isActiveWorktree: true,
        automationRun: expect.objectContaining({ hostId: 'local', runId: 'run-1' })
      }),
      expect.anything()
    )
  })

  it('preserves the remote authority and SSH selector for click routing', () => {
    deliverAutomationRunAlert({
      alert: { ...alert, executionHostId: 'local' },
      environmentId: 'env-1',
      selector: { kind: 'ssh', targetId: 'ssh-1' }
    })
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        automationRun: expect.objectContaining({
          hostId: 'runtime:env-1',
          catalogRef: {
            authority: { kind: 'runtime', environmentId: 'env-1' },
            selector: { kind: 'ssh', targetId: 'ssh-1' }
          }
        })
      }),
      expect.anything()
    )
    expect(mocks.markWorktreeUnread).not.toHaveBeenCalled()
  })

  it.each([
    {
      executionHostId: 'ssh:ssh-1' as const,
      hostId: 'local' as const,
      selector: { kind: 'self' as const }
    },
    {
      executionHostId: 'local' as const,
      hostId: 'ssh:ssh-1' as const,
      selector: { kind: 'ssh' as const, targetId: 'ssh-1' }
    }
  ])(
    'keeps the run notification source after retargeting: $executionHostId',
    ({ executionHostId, hostId, selector }) => {
      deliverAutomationRunAlert({ alert: { ...alert, executionHostId }, selector })
      expect(mocks.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationSourceId: executionHostId,
          automationRun: expect.objectContaining({
            hostId,
            catalogRef: { authority: { kind: 'desktop' }, selector }
          })
        }),
        expect.anything()
      )
    }
  )

  it('opens run history without requiring a surviving terminal', () => {
    openAutomationRunNotification({
      automationId: 'auto-1',
      runId: 'run-1',
      hostId: 'runtime:env-1'
    })
    expect(mocks.setPendingAutomationRunNavigation).toHaveBeenCalledWith({
      automationId: 'auto-1',
      runId: 'run-1',
      hostId: 'runtime:env-1'
    })
    expect(mocks.openAutomationsPage).toHaveBeenCalledOnce()
  })
})
