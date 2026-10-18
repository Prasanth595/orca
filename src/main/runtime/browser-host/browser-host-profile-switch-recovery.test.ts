import { afterEach, describe, expect, it, vi } from 'vitest'
import { switchBrowserHostClientProfile } from './browser-host-client-profile-switch'
import { BROWSER_CLIENT_PROFILE_SWITCH_CAPABILITY } from '../../../shared/browser-client-profile-switch-protocol'

afterEach(() => vi.useRealTimers())

function recoveryFixture(result: Promise<{ status: 'completed' }>) {
  const expected = {
    browserHostClientId: 'client',
    browserHostGeneration: 1,
    pageHostGeneration: 1
  }
  const replacement = { ...expected, pageHostGeneration: 2 }
  const ledger = {
    issue: vi
      .fn()
      .mockReturnValueOnce({ result })
      .mockReturnValue({ result: Promise.resolve({ status: 'completed' }) }),
    retirePage: vi.fn(),
    advancePageGeneration: vi.fn()
  }
  const grant = { placement: expected, release: vi.fn(), executionHostKey: 'host' }
  const placements = {
    reserveNewClientPage: vi.fn().mockReturnValue({ placement: replacement }),
    commitClientPageReplacement: vi.fn().mockImplementation(() => {
      throw new Error('browser_page_placement_stale')
    }),
    cancelClientPageReservation: vi.fn()
  }
  const input = {
    timeoutMs: 10,
    registry: {
      requireClientPage: vi.fn().mockReturnValue(expected),
      select: vi.fn().mockReturnValue({
        ...expected,
        hostCapabilities: [BROWSER_CLIENT_PROFILE_SWITCH_CAPABILITY],
        pageReconciliationProtocolVersion: 1
      })
    },
    state: () => ({
      commandLedger: ledger,
      lease: { authorityRuntimeId: 'runtime', authorityEpoch: 'epoch' }
    }),
    placements,
    grants: new Map([['page', grant]])
  } as unknown as Parameters<typeof switchBrowserHostClientProfile>[2]
  const authority = {
    ...expected,
    browserPageId: 'page',
    authorityRuntimeId: 'runtime',
    authorityEpoch: 'epoch'
  }
  return { input, authority, ledger, placements }
}

describe('profile switch failure convergence', () => {
  it('bounds a stalled result, cancels its reservation and fences its pending ledger page', async () => {
    vi.useFakeTimers()
    const f = recoveryFixture(new Promise(() => {}))
    const rejected = expect(
      switchBrowserHostClientProfile(
        f.authority,
        { id: 'isolated', label: 'Isolated', scope: 'isolated' },
        f.input
      )
    ).rejects.toThrow('browser_host_page_creation_timeout')
    await vi.advanceTimersByTimeAsync(11)
    await rejected
    expect(f.placements.cancelClientPageReservation).toHaveBeenCalledOnce()
    expect(f.ledger.retirePage).toHaveBeenCalledWith('page', 1)
    expect(f.ledger.issue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pageHostGeneration: 2,
        command: expect.objectContaining({ type: 'closePage' })
      })
    )
  })

  it('closes the completed replacement when the host cannot commit it', async () => {
    const f = recoveryFixture(Promise.resolve({ status: 'completed' }))
    await expect(
      switchBrowserHostClientProfile(
        f.authority,
        { id: 'isolated', label: 'Isolated', scope: 'isolated' },
        f.input
      )
    ).rejects.toThrow('browser_page_placement_stale')
    expect(f.ledger.retirePage).toHaveBeenCalledWith('page', 1)
    expect(f.ledger.issue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pageHostGeneration: 2,
        command: expect.objectContaining({ type: 'closePage' })
      })
    )
  })
})
