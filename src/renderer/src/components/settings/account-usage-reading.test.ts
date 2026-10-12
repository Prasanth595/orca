import { describe, expect, it } from 'vitest'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import type { ProviderAccountsSnapshot } from '@/runtime/runtime-provider-accounts-client'
import { accountUsageReading } from './account-usage-reading'

const host = { runtime: 'host' } as const
const ubuntu = { runtime: 'wsl', wslDistro: 'Ubuntu' } as const
const debian = { runtime: 'wsl', wslDistro: 'Debian' } as const
const limits = (provider: 'claude' | 'codex', usedPercent: number): ProviderRateLimits => ({
  provider,
  status: 'ok',
  error: null,
  updatedAt: 100,
  session: null,
  weekly: { usedPercent, windowMinutes: 10080, resetsAt: 1000, resetDescription: null }
})

function snapshot(): ProviderAccountsSnapshot {
  return {
    claude: { accounts: [], activeAccountId: 'claude-a' },
    codex: { accounts: [], activeAccountId: 'codex-a' },
    rateLimits: {
      ...createEmptyRateLimitState(),
      claude: limits('claude', 25),
      codex: limits('codex', 80),
      inactiveClaudeAccounts: [
        {
          accountId: 'claude-b',
          rateLimits: limits('claude', 90),
          updatedAt: 100,
          isFetching: false
        }
      ],
      inactiveCodexAccounts: [
        { accountId: 'codex-b', rateLimits: limits('codex', 10), updatedAt: 100, isFetching: false }
      ]
    }
  }
}

describe('account usage attribution', () => {
  it('shows active and inactive accounts together, including weekly-only plans', () => {
    const data = snapshot()
    expect(
      accountUsageReading(data, 'claude', 'claude-a', host)?.rateLimits?.weekly?.usedPercent
    ).toBe(25)
    expect(
      accountUsageReading(data, 'claude', 'claude-b', host)?.rateLimits?.weekly?.usedPercent
    ).toBe(90)
    expect(
      accountUsageReading(data, 'codex', 'codex-a', host)?.rateLimits?.weekly?.usedPercent
    ).toBe(80)
    expect(
      accountUsageReading(data, 'codex', 'codex-b', host)?.rateLimits?.weekly?.usedPercent
    ).toBe(10)
    expect(accountUsageReading(data, 'codex', 'claude-b', host)).toBeNull()
  })

  it('does not assign active usage to System default or an unknown account', () => {
    expect(accountUsageReading(snapshot(), 'codex', null, host)).toBeNull()
    expect(accountUsageReading(snapshot(), 'codex', 'missing', host)).toBeNull()
    const data = snapshot()
    data.codex.activeAccountId = null
    expect(accountUsageReading(data, 'codex', null, host)?.rateLimits?.weekly?.usedPercent).toBe(80)
  })

  it('never borrows another WSL distro or host reading for an active account', () => {
    const data = snapshot()
    data.codex.activeAccountIdsByRuntime = {
      host: 'codex-a',
      wsl: { Ubuntu: 'codex-u', Debian: 'codex-d' }
    }
    if (!data.rateLimits) {
      throw new Error('Missing fixture')
    }
    data.rateLimits.codexTarget = ubuntu
    expect(accountUsageReading(data, 'codex', 'codex-a', host)).toBeNull()
    expect(accountUsageReading(data, 'codex', 'codex-d', debian)).toBeNull()
    expect(
      accountUsageReading(data, 'codex', 'codex-u', ubuntu)?.rateLimits?.weekly?.usedPercent
    ).toBe(80)
  })

  it('keeps missing and failed snapshots unknown instead of reporting zero usage', () => {
    expect(accountUsageReading(null, 'codex', 'codex-a', host)).toBeNull()
    const data = snapshot()
    data.failedProviders = ['claude']
    expect(accountUsageReading(data, 'claude', 'claude-b', host)).toBeNull()
    expect(accountUsageReading(data, 'codex', 'codex-b', host)).not.toBeNull()
    data.rateLimits = null
    expect(accountUsageReading(data, 'codex', 'codex-b', host)).toBeNull()
  })

  it('does not reuse the old active reading after a switch clears it', () => {
    const data = snapshot()
    data.codex.activeAccountId = 'codex-b'
    if (!data.rateLimits) {
      throw new Error('Missing fixture')
    }
    data.rateLimits.codex = {
      ...limits('codex', 80),
      status: 'fetching',
      weekly: null,
      updatedAt: 0
    }
    const reading = accountUsageReading(data, 'codex', 'codex-b', host)
    expect(reading?.isFetching).toBe(true)
    expect(reading?.rateLimits?.weekly).toBeNull()
  })
})
