import { afterEach, expect, it, vi } from 'vitest'
import {
  prepareStructuredAccountAllocation,
  rankStructuredAccountCandidates,
  withStructuredAccountAllocation
} from './structured-account-allocation'
import {
  allocationSnapshot,
  allocationUsage,
  ALLOCATION_NOW
} from './structured-account-allocation.test-fixture'

afterEach(() => vi.restoreAllMocks())

it('ranks only matching host/provider identities and never attributes WSL active usage to host accounts', () => {
  const snapshot = allocationSnapshot()
  expect(
    rankStructuredAccountCandidates(snapshot, 'codex', ALLOCATION_NOW).map((c) => c.accountId)
  ).toEqual(['a', 'b'])
  snapshot.codex.accounts[1].managedHomeRuntime = 'wsl'
  snapshot.rateLimits.codexTarget = { runtime: 'wsl', wslDistro: 'Other' }
  expect(rankStructuredAccountCandidates(snapshot, 'codex', ALLOCATION_NOW)).toEqual([])
  expect(rankStructuredAccountCandidates(snapshot, 'claude', ALLOCATION_NOW)).toEqual([])
})

it.each(['error', 'fetching', 'unavailable', 'idle'] as const)(
  'excludes %s usage even with cached numbers',
  (status) => {
    const snapshot = allocationSnapshot()
    snapshot.rateLimits.codex = { ...allocationUsage(), status }
    snapshot.rateLimits.inactiveCodexAccounts = []
    expect(rankStructuredAccountCandidates(snapshot, 'codex', ALLOCATION_NOW)).toEqual([])
  }
)

it.each([Number.NaN, -1, 100, 101])('excludes invalid or exhausted consumption %s', (used) => {
  const snapshot = allocationSnapshot()
  snapshot.rateLimits.codex = allocationUsage(used)
  snapshot.rateLimits.inactiveCodexAccounts = []
  expect(rankStructuredAccountCandidates(snapshot, 'codex', ALLOCATION_NOW)).toEqual([])
})

it('requires fresh successful timestamps, future reset times, and interpretable windows', () => {
  for (const usage of [
    { ...allocationUsage(), updatedAt: ALLOCATION_NOW - 300_001 },
    { ...allocationUsage(), updatedAt: ALLOCATION_NOW + 1 },
    { ...allocationUsage(), session: null },
    { ...allocationUsage(), session: { ...allocationUsage().session!, resetsAt: ALLOCATION_NOW } },
    { ...allocationUsage(), buckets: [{ ...allocationUsage().session!, name: 'model-specific' }] }
  ]) {
    const snapshot = allocationSnapshot()
    snapshot.rateLimits.codex = usage
    snapshot.rateLimits.inactiveCodexAccounts = []
    expect(rankStructuredAccountCandidates(snapshot, 'codex', ALLOCATION_NOW)).toEqual([])
  }
})

it('uses the tightest window and excludes Claude profiles that need sign-in', () => {
  const snapshot = allocationSnapshot()
  snapshot.claude = {
    activeAccountId: 'c',
    accounts: [
      {
        id: 'c',
        email: 'synthetic@example.test',
        authMethod: 'subscription-oauth',
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      }
    ]
  }
  snapshot.rateLimits.claude = {
    ...allocationUsage(),
    provider: 'claude',
    weekly: { ...allocationUsage().session!, usedPercent: 95 }
  }
  expect(rankStructuredAccountCandidates(snapshot, 'claude', ALLOCATION_NOW)[0]?.headroom).toBe(5)
  snapshot.claude.accounts[0].needsSignIn = true
  expect(rankStructuredAccountCandidates(snapshot, 'claude', ALLOCATION_NOW)).toEqual([])
})

it('spreads serialized launches until usage refreshes, releases the queue on failure, and isolates hosts', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(ALLOCATION_NOW)
  const runtime = {
    getRuntimeId: () => 'runtime-a',
    refreshAccountsForMobileSubscriber: vi.fn(async () => {}),
    getAccountsSnapshot: allocationSnapshot
  }
  const host = { deps: { store: { getRecord: () => null } } }
  const input = { runtime, host, agent: 'codex', sessionId: 'new' }
  const selected: string[] = []
  const launch = () =>
    withStructuredAccountAllocation(runtime, async () => {
      const pick = await prepareStructuredAccountAllocation(input)
      selected.push(pick.managedAccountId!)
      pick.committed()
    })
  await Promise.all([launch(), launch()])
  expect(selected).toEqual(['a', 'b'])
  await expect(
    withStructuredAccountAllocation(runtime, async () => {
      throw new Error('refused')
    })
  ).rejects.toThrow('refused')
  await launch()
  const other = await prepareStructuredAccountAllocation({
    ...input,
    runtime: { ...runtime, getRuntimeId: () => 'runtime-b' }
  })
  expect(other.managedAccountId).toBe('a')
})

it('refuses unknown usage without writing selection or claiming a quota reservation', async () => {
  const snapshot = allocationSnapshot()
  snapshot.rateLimits.codex = null
  snapshot.rateLimits.inactiveCodexAccounts = []
  const runtime = {
    getRuntimeId: () => 'runtime-a',
    refreshAccountsForMobileSubscriber: vi.fn(async () => {}),
    getAccountsSnapshot: () => snapshot
  }
  await expect(
    prepareStructuredAccountAllocation({
      runtime,
      host: { deps: { store: { getRecord: () => null } } },
      agent: 'codex',
      sessionId: 'new'
    })
  ).rejects.toThrow('No saved account')
})
