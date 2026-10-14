import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOMATION_INBOX_RUNTIME_CAPABILITY } from '../../../shared/automation-runtime-capabilities'
import { makeAutomationInboxEntry } from '../../../shared/automation-inbox-test-fixture'
import { automationInboxEntryKey } from '../../../shared/automation-inbox'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  receiveAutomationInbox: vi.fn(),
  deliver: vi.fn(),
  revision: 1,
  generation: 1,
  profileId: 'profile-1',
  ready: true
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeOrcaProfileId: mocks.profileId,
      persistedUIReady: mocks.ready,
      receiveAutomationInbox: mocks.receiveAutomationInbox
    })
  }
}))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.call }))
vi.mock('@/runtime/runtime-environment-revision', () => ({
  getRuntimeEnvironmentRevision: () => mocks.revision
}))
vi.mock('@/store/slices/runtime-status', () => ({
  getRuntimeEnvironmentConnectionGeneration: () => mocks.generation
}))
vi.mock('@/attention/agent-attention-notification-delivery', () => ({
  deliverAgentAttentionNotification: mocks.deliver,
  readAgentAttentionNotificationSound: vi.fn()
}))

import { refreshAutomationInbox } from './automation-inbox-sync'

const TARGET = { kind: 'environment', environmentId: 'env-1' } as const
const STATUS = { capabilities: [AUTOMATION_INBOX_RUNTIME_CAPABILITY] }
const ALERTS = [{ alert: makeAutomationInboxEntry().alert, selector: { kind: 'self' as const } }]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.call.mockReset()
  mocks.revision = 1
  mocks.generation = 1
  mocks.profileId = 'profile-1'
  mocks.ready = true
})

describe('automation inbox catch-up', () => {
  it('recovers remote records in one store update without replaying desktop banners', async () => {
    mocks.call.mockResolvedValueOnce(STATUS).mockResolvedValueOnce({ alerts: ALERTS })
    const first = refreshAutomationInbox(TARGET)
    expect(refreshAutomationInbox(TARGET)).toBe(first)
    await first
    expect(mocks.call).toHaveBeenCalledTimes(2)
    expect(mocks.receiveAutomationInbox).toHaveBeenCalledOnce()
    const entry = makeAutomationInboxEntry({}, 'host:runtime:env-1:self')
    expect(mocks.receiveAutomationInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        [automationInboxEntryKey(entry)]: expect.objectContaining({
          catalogKey: entry.catalogKey,
          alert: expect.objectContaining({ runId: 'run-1', hostId: 'runtime:env-1' })
        })
      })
    )
    expect(mocks.deliver).not.toHaveBeenCalled()
  })

  it('skips unsupported hosts and waits until persisted read state has loaded', async () => {
    mocks.ready = false
    await refreshAutomationInbox(TARGET)
    expect(mocks.call).not.toHaveBeenCalled()
    mocks.ready = true
    mocks.call.mockResolvedValue({ capabilities: [] })
    await refreshAutomationInbox(TARGET)
    expect(mocks.call).toHaveBeenCalledOnce()
    expect(mocks.receiveAutomationInbox).not.toHaveBeenCalled()
  })

  it.each(['revision', 'generation', 'profileId'] as const)(
    'rejects a late snapshot after %s changed',
    async (field) => {
      const response = Promise.withResolvers<{ alerts: typeof ALERTS }>()
      mocks.call.mockResolvedValueOnce(STATUS).mockReturnValueOnce(response.promise)
      const pending = refreshAutomationInbox(TARGET)
      await Promise.resolve()
      if (field === 'profileId') {
        mocks.profileId = 'profile-2'
      } else {
        mocks[field] += 1
      }
      response.resolve({ alerts: ALERTS })
      await pending
      expect(mocks.receiveAutomationInbox).not.toHaveBeenCalled()
    }
  )
})
