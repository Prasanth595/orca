import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoIcon } from '../../shared/repo-icon'
import {
  getDispatchHandler,
  notificationCtorMock,
  resetNotificationDispatchMocks,
  notificationTestStore
} from './notifications-test-harness'

vi.mock('electron', async () =>
  (await import('./notifications-test-harness')).createElectronModuleMock()
)

vi.mock('./notification-authorization-status', async () =>
  (await import('./notifications-test-harness')).createNotificationAuthorizationModuleMock()
)

vi.mock('./ui', async () =>
  (await import('./notifications-test-harness')).createTrustedUIRendererModuleMock()
)

vi.mock('../tray/system-tray', async () =>
  (await import('./notifications-test-harness')).createSystemTrayModuleMock()
)

import { registerNotificationHandlers } from './notifications'

const UPLOAD_ICON_SRC = 'data:image/png;base64,iVBORw0KGgo='

async function dispatchFor(worktreeId: string, repoIcon: RepoIcon | null): Promise<void> {
  registerNotificationHandlers(
    notificationTestStore({
      getSettings: () => ({
        notifications: {
          enabled: true,
          agentTaskComplete: true,
          terminalBell: false,
          suppressWhenFocused: true
        }
      }),
      getRepo: (id: string) => (id === 'repo' ? { id: 'repo', repoIcon } : undefined)
    })
  )
  await getDispatchHandler()(
    {},
    { source: 'agent-task-complete', worktreeId, worktreeLabel: 'feat/icon', repoLabel: 'orca' }
  )
}

describe('notification repo icon', () => {
  beforeEach(() => {
    resetNotificationDispatchMocks()
  })

  it('shows an uploaded project image as the notification icon', async () => {
    await dispatchFor('repo::/src/orca', {
      type: 'image',
      src: UPLOAD_ICON_SRC,
      source: 'upload'
    })

    expect(notificationCtorMock).toHaveBeenCalledWith({
      title: 'Task complete in feat/icon',
      body: 'orca',
      icon: { dataUrl: UPLOAD_ICON_SRC, isEmpty: expect.any(Function) },
      ...(process.platform === 'darwin' ? { sound: 'default' } : {})
    })
  })

  it('leaves remote github avatars out of the notification', async () => {
    await dispatchFor('repo::/src/orca', {
      type: 'image',
      src: 'https://github.com/stablyai.png?size=64',
      source: 'github'
    })

    expect(notificationCtorMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ icon: expect.anything() })
    )
  })

  it('leaves folder workspaces without a repo icon', async () => {
    await dispatchFor('folder:abc', { type: 'image', src: UPLOAD_ICON_SRC, source: 'upload' })

    expect(notificationCtorMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ icon: expect.anything() })
    )
  })
})
