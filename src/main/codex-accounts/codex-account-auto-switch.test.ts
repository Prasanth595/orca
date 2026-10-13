import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import type { CodexManagedAccountSummary } from '../../shared/managed-account-types'
import type { ProviderRateLimits, RateLimitState } from '../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../shared/rate-limit-state-factory'
import { createCodexAccountAutoSwitch } from './codex-account-auto-switch'
import { ACCOUNT_AUTO_SWITCH_COOLDOWN_MS } from '../accounts/account-auto-switch-policy'

const HOST = { runtime: 'host' as const, wslDistro: null }

function account(
  id: string,
  overrides: Partial<CodexManagedAccountSummary> = {}
): CodexManagedAccountSummary {
  return {
    id,
    email: `${id}@example.test`,
    managedHomeRuntime: 'host',
    wslDistro: null,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...overrides
  }
}

function limits(usedPercent: number, updatedAt = Date.now()): ProviderRateLimits {
  return {
    provider: 'codex',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt,
    error: null,
    status: 'ok'
  }
}

// `tag` names the account the active reading was fetched for, as the usage fetcher does.
function usageState(
  active: ProviderRateLimits,
  inactive: Record<string, ProviderRateLimits>,
  tag = 'a',
  target: RateLimitState['codexTarget'] = HOST
): RateLimitState {
  return createEmptyRateLimitState({
    codex: { ...active, usageMetadata: { managedAccountId: tag } },
    codexTarget: target,
    inactiveCodexAccounts: Object.entries(inactive).map(([accountId, rateLimits]) => ({
      accountId,
      rateLimits,
      updatedAt: rateLimits.updatedAt,
      isFetching: false
    }))
  })
}

// What the usage service publishes, synchronously, once it has started reading the accounts.
function withReadUnderWay(state: RateLimitState): RateLimitState {
  return {
    ...state,
    inactiveCodexAccounts: state.inactiveCodexAccounts.map((usage) => ({
      ...usage,
      isFetching: true
    }))
  }
}

function setup(accounts = [account('a'), account('b'), account('c')]) {
  const settings = {
    ...getDefaultSettings('/tmp'),
    activeCodexManagedAccountId: 'a',
    codexAutoSwitchEnabled: true
  }
  if (accounts[0]?.managedHomeRuntime === 'wsl') {
    settings.activeCodexManagedAccountIdsByRuntime = {
      host: null,
      wsl: { [accounts[0].wslDistro ?? '__default__']: 'a' }
    }
  }
  const selectAccount = vi.fn(async (accountId: string, _target, stillWanted: () => boolean) => {
    if (!stillWanted()) {
      return false
    }
    settings.activeCodexManagedAccountId = accountId
    return true
  })
  const fetchInactiveUsage = vi.fn(async () => {})
  const onSwitched = vi.fn()
  const autoSwitch = createCodexAccountAutoSwitch({
    getSettings: () => settings,
    rateLimits: { fetchInactiveCodexAccountsOnOpen: fetchInactiveUsage },
    accounts: {
      listAccounts: () => ({ accounts, activeAccountId: settings.activeCodexManagedAccountId }),
      autoSelectAccountForTarget: selectAccount
    },
    onSwitched
  })
  // Holds the next switch in the queue until `release` runs, as a pending sign-in would.
  const holdNextSwitch = (): (() => void) => {
    let release: () => void = () => {}
    selectAccount.mockImplementationOnce(async (accountId, _target, stillWanted) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      if (!stillWanted()) {
        return false
      }
      settings.activeCodexManagedAccountId = accountId
      return true
    })
    return () => release()
  }
  return { settings, autoSwitch, selectAccount, fetchInactiveUsage, onSwitched, holdNextSwitch }
}

describe('createCodexAccountAutoSwitch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves new sessions to the account with the most room and reports it', async () => {
    const { autoSwitch, selectAccount, onSwitched } = setup()

    autoSwitch(usageState(limits(95), { b: limits(50), c: limits(20) }))
    await vi.runAllTimersAsync()

    expect(selectAccount).toHaveBeenCalledWith('c', HOST, expect.any(Function))
    expect(onSwitched).toHaveBeenCalledWith({ from: 'a@example.test', to: 'c@example.test' })
  })

  it('logs one switch without account identifiers', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { autoSwitch } = setup()
    autoSwitch(usageState(limits(95), { b: limits(50), c: limits(20) }))
    await vi.runAllTimersAsync()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '[codex-accounts] Auto-switched account for new sessions'
    )
  })

  it('honors manual selection before the first usage reading', () => {
    const { settings, autoSwitch, selectAccount } = setup()
    settings.activeCodexManagedAccountId = 'b'
    autoSwitch(usageState(limits(95), { a: limits(30), c: limits(20) }, 'b'))
    expect(selectAccount).not.toHaveBeenCalled()
  })

  it('does nothing while auto-switch is off', () => {
    const { settings, autoSwitch, selectAccount, fetchInactiveUsage } = setup()
    settings.codexAutoSwitchEnabled = false

    autoSwitch(usageState(limits(100), { b: limits(0) }))

    expect(selectAccount).not.toHaveBeenCalled()
    expect(fetchInactiveUsage).not.toHaveBeenCalled()
  })

  it('asks for a new reading of the other accounts until one is under way', async () => {
    const { autoSwitch, selectAccount, fetchInactiveUsage } = setup([account('a'), account('b')])
    const hourAgo = Date.now() - 60 * 60_000
    const stale = usageState(limits(95), { b: limits(10, hourAgo) })

    // The usage service skips a read it debounces, so an ask can start nothing.
    autoSwitch(stale)
    autoSwitch(stale)
    await Promise.resolve()
    expect(fetchInactiveUsage).toHaveBeenCalledTimes(2)

    autoSwitch(withReadUnderWay(stale))
    autoSwitch(stale)
    await Promise.resolve()
    expect(fetchInactiveUsage).toHaveBeenCalledTimes(2)
    expect(selectAccount).not.toHaveBeenCalled()
  })

  it('asks for the reading only after the update it reacted to has gone out', async () => {
    const { autoSwitch, fetchInactiveUsage } = setup([account('a'), account('b')])
    const hourAgo = Date.now() - 60 * 60_000

    // The usage service publishes from inside the ask, and must not do so mid-publish.
    autoSwitch(usageState(limits(95), { b: limits(10, hourAgo) }))
    expect(fetchInactiveUsage).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(fetchInactiveUsage).toHaveBeenCalledOnce()
  })

  it('does not count a read of another runtime as a read of its own accounts', async () => {
    const { autoSwitch, fetchInactiveUsage } = setup([
      account('a'),
      account('b'),
      account('wsl', { managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' })
    ])
    const hourAgo = Date.now() - 60 * 60_000
    const state = usageState(limits(95), { b: limits(10, hourAgo), wsl: limits(0) })

    autoSwitch({
      ...state,
      inactiveCodexAccounts: state.inactiveCodexAccounts.map((usage) =>
        usage.accountId === 'wsl' ? { ...usage, isFetching: true } : usage
      )
    })
    await Promise.resolve()

    expect(fetchInactiveUsage).toHaveBeenCalledOnce()
  })

  it('never picks an account from another runtime ', () => {
    const { autoSwitch, selectAccount } = setup([
      account('a'),
      account('wsl', { managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' }),
      account('b')
    ])

    autoSwitch(usageState(limits(95), { wsl: limits(0), b: limits(40) }))

    expect(selectAccount).toHaveBeenCalledWith('b', HOST, expect.any(Function))
  })

  it('leaves an account picked by hand alone until the cooldown ends', () => {
    const { settings, autoSwitch, selectAccount } = setup()
    autoSwitch(usageState(limits(30), { b: limits(95), c: limits(20) }))

    settings.activeCodexManagedAccountId = 'b'
    autoSwitch(usageState(limits(95), { a: limits(30), c: limits(20) }, 'b'))
    expect(selectAccount).not.toHaveBeenCalled()

    vi.advanceTimersByTime(ACCOUNT_AUTO_SWITCH_COOLDOWN_MS)
    autoSwitch(usageState(limits(95), { a: limits(30), c: limits(20) }, 'b'))
    expect(selectAccount).toHaveBeenCalledWith('c', HOST, expect.any(Function))
  })

  it("never reads the previous account's usage as the new account's", () => {
    const { settings, autoSwitch, selectAccount } = setup()
    autoSwitch(usageState(limits(50), { b: limits(10), c: limits(20) }))

    settings.activeCodexManagedAccountId = 'b'
    autoSwitch(usageState(limits(50), { a: limits(50), c: limits(20) }, 'a'))
    vi.advanceTimersByTime(1_000)
    autoSwitch(usageState(limits(100), { a: limits(50), c: limits(20) }, 'a'))

    expect(selectAccount).not.toHaveBeenCalled()
  })

  it('does nothing with fewer than two accounts, even with cached usage', () => {
    const { autoSwitch, selectAccount, fetchInactiveUsage } = setup([account('a')])
    autoSwitch(usageState(limits(100), { b: limits(0) }))
    expect(selectAccount).not.toHaveBeenCalled()
    expect(fetchInactiveUsage).not.toHaveBeenCalled()
  })

  it('ignores a reading whose limiting window has reset', () => {
    const { autoSwitch, selectAccount } = setup()
    const reading = limits(100)
    autoSwitch(
      usageState(
        {
          ...reading,
          session: {
            usedPercent: 100,
            windowMinutes: 300,
            resetsAt: Date.now(),
            resetDescription: null
          }
        },
        { b: limits(0), c: limits(20) }
      )
    )
    expect(selectAccount).not.toHaveBeenCalled()
  })

  it('reads a WSL account by its managed account ID', () => {
    const ubuntu = { runtime: 'wsl' as const, wslDistro: 'Ubuntu' }
    const { settings, autoSwitch, selectAccount } = setup([
      account('a', { managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' }),
      account('b', { managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' })
    ])
    settings.activeCodexManagedAccountIdsByRuntime = { host: null, wsl: { Ubuntu: 'a' } }

    autoSwitch(usageState(limits(95), { b: limits(10) }, 'a', ubuntu))

    expect(selectAccount).toHaveBeenCalledWith('b', ubuntu, expect.any(Function))
  })

  it('finds the other accounts of the default WSL distro', () => {
    const defaultDistro = { runtime: 'wsl' as const, wslDistro: null }
    const { settings, autoSwitch, selectAccount } = setup([
      account('a', { managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' }),
      account('b', { managedHomeRuntime: 'wsl', wslDistro: 'Ubuntu' }),
      account('host')
    ])
    settings.activeCodexManagedAccountIdsByRuntime = { host: null, wsl: { Ubuntu: 'a' } }

    autoSwitch(usageState(limits(95), { b: limits(10), host: limits(0) }, 'a', defaultDistro))

    expect(selectAccount).toHaveBeenCalledWith('b', defaultDistro, expect.any(Function))
  })

  it('does not wait for an account the usage service cannot read yet', async () => {
    const { autoSwitch, selectAccount, fetchInactiveUsage } = setup()
    const hourAgo = Date.now() - 60 * 60_000
    const insideRetryAfter = {
      ...limits(10, hourAgo),
      usageMetadata: { retryAtMs: Date.now() + 60_000 }
    }

    autoSwitch(usageState(limits(95), { b: limits(20), c: insideRetryAfter }))
    await Promise.resolve()

    expect(fetchInactiveUsage).not.toHaveBeenCalled()
    expect(selectAccount).toHaveBeenCalledWith('b', HOST, expect.any(Function))
  })

  it('drops a queued switch once the selection changed by hand', async () => {
    const { settings, autoSwitch, onSwitched, holdNextSwitch } = setup()
    const release = holdNextSwitch()

    autoSwitch(usageState(limits(95), { b: limits(50), c: limits(20) }))
    settings.activeCodexManagedAccountId = 'b'
    release()
    await vi.runAllTimersAsync()

    expect(settings.activeCodexManagedAccountId).toBe('b')
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it('drops a queued switch once the usage is back under the line', async () => {
    const { settings, autoSwitch, onSwitched, holdNextSwitch } = setup()
    const release = holdNextSwitch()

    autoSwitch(usageState(limits(95), { b: limits(50), c: limits(20) }))
    vi.advanceTimersByTime(1_000)
    autoSwitch(usageState(limits(40), { b: limits(50), c: limits(20) }))
    release()
    await vi.runAllTimersAsync()

    expect(settings.activeCodexManagedAccountId).toBe('a')
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it("waits for every account's reading before picking one", async () => {
    const { autoSwitch, selectAccount, fetchInactiveUsage } = setup()
    const hourAgo = Date.now() - 60 * 60_000

    autoSwitch(usageState(limits(95), { b: limits(70), c: limits(0, hourAgo) }))
    await Promise.resolve()
    expect(fetchInactiveUsage).toHaveBeenCalledOnce()
    expect(selectAccount).not.toHaveBeenCalled()

    autoSwitch(usageState(limits(95), { b: limits(70), c: limits(0) }))
    expect(selectAccount).toHaveBeenCalledWith('c', HOST, expect.any(Function))
  })

  it('switches once while a switch is still running', () => {
    const { autoSwitch, selectAccount } = setup([account('a'), account('b')])
    selectAccount.mockReturnValue(new Promise(() => {}))

    autoSwitch(usageState(limits(100), { b: limits(10) }))
    autoSwitch(usageState(limits(100), { b: limits(10) }))

    expect(selectAccount).toHaveBeenCalledOnce()
  })

  it('picks from the accounts it could read once a read was tried', async () => {
    const { autoSwitch, selectAccount, fetchInactiveUsage } = setup()
    const hourAgo = Date.now() - 60 * 60_000
    const state = usageState(limits(95), { b: limits(20), c: limits(10, hourAgo) })
    fetchInactiveUsage.mockImplementation(async () => autoSwitch(withReadUnderWay(state)))

    autoSwitch(state)
    await Promise.resolve()
    expect(selectAccount).not.toHaveBeenCalled()

    autoSwitch(state)
    expect(fetchInactiveUsage).toHaveBeenCalledOnce()
    expect(selectAccount).toHaveBeenCalledWith('b', HOST, expect.any(Function))
  })

  it('waits for a new usage reading before trying again after a failed switch', async () => {
    const { autoSwitch, selectAccount } = setup([account('a'), account('b')])
    selectAccount.mockRejectedValueOnce(new Error('sync failed'))
    const atLimit = limits(100)

    autoSwitch(usageState(atLimit, { b: limits(10) }))
    vi.advanceTimersByTime(1_000)
    await vi.runAllTimersAsync()
    autoSwitch(usageState(atLimit, { b: limits(10) }))
    expect(selectAccount).toHaveBeenCalledOnce()

    autoSwitch(usageState(limits(100), { b: limits(10) }))
    expect(selectAccount).toHaveBeenCalledTimes(2)
  })
})
