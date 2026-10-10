import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNotificationEventHandler,
  getTrustedUIRendererWindowMock,
  resetNotificationDispatchMocks
} from './notifications-test-harness'
import type { NotificationSettings } from '../../shared/notification-settings-types'
import {
  automationRunNotificationRequest,
  type AutomationRunAlert
} from '../../shared/automation-run-alert'

vi.mock('electron', async () =>
  (await import('./notifications-test-harness')).createElectronModuleMock()
)
vi.mock('./ui', async () =>
  (await import('./notifications-test-harness')).createTrustedUIRendererModuleMock()
)
vi.mock('../window/focus-existing-window', () => ({ safelyRevealWindow: vi.fn() }))
import { deliverNativeNotification } from './native-notification-delivery'
import { buildNotificationOptions } from './notification-options'

const settings: NotificationSettings = {
  enabled: true,
  agentTaskComplete: true,
  terminalBell: true,
  suppressWhenFocused: true,
  customSoundId: 'system',
  customSoundPath: null,
  customSoundVolume: 1,
  mutedNotificationSourceIds: []
}
const alert: AutomationRunAlert = {
  automationId: 'auto-1',
  runId: 'run-1',
  hostId: 'runtime:host-1',
  title: 'Daily run',
  message: 'Login expired',
  status: 'failed',
  workspaceId: null,
  paneKey: null,
  createdAt: 1
}

describe('automation notification navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetNotificationDispatchMocks()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('opens the exact run even when launch failed before a workspace existed', () => {
    const send = vi.fn()
    getTrustedUIRendererWindowMock.mockReturnValue({
      isDestroyed: () => false,
      webContents: { send }
    })
    const request = automationRunNotificationRequest(alert)
    deliverNativeNotification(request, buildNotificationOptions(request), settings)
    getNotificationEventHandler('click')()
    expect(send).toHaveBeenCalledWith('automations:openRun', alert)
    expect(send).toHaveBeenCalledOnce()
  })
})
