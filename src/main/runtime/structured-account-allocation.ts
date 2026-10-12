import type { AccountsSnapshot } from './runtime-account-controller'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import type { AgentSessionAccountHome } from '../../shared/agent-session-account-home'
import type { OrcaRuntimeService } from './orca-runtime'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'

const MAX_USAGE_AGE_MS = 5 * 60_000
const queues = new WeakMap<Pick<OrcaRuntimeService, 'getRuntimeId'>, Promise<unknown>>()
const allocations = new WeakMap<
  Pick<OrcaRuntimeService, 'getRuntimeId'>,
  Map<string, { updatedAt: number; count: number }>
>()

/** Serializes selection through commit, including calls from different clients of this host. */
export async function withStructuredAccountAllocation<T>(
  host: Pick<OrcaRuntimeService, 'getRuntimeId'>,
  run: () => Promise<T>
): Promise<T> {
  const prior = queues.get(host) ?? Promise.resolve()
  const next = prior.catch(() => {}).then(run)
  queues.set(host, next)
  try {
    return await next
  } finally {
    if (queues.get(host) === next) {
      queues.delete(host)
    }
  }
}

function availableHeadroom(
  usage: ProviderRateLimits | null | undefined,
  now: number
): number | null {
  if (
    !usage ||
    usage.status !== 'ok' ||
    usage.error ||
    !Number.isFinite(usage.updatedAt) ||
    usage.updatedAt <= 0 ||
    usage.updatedAt > now ||
    now - usage.updatedAt > MAX_USAGE_AGE_MS ||
    usage.buckets?.length
  ) {
    return null
  }
  // Without a selected model, use the tightest reported window and refuse named model buckets.
  const windows = [usage.session, usage.weekly, usage.monthly, usage.fableWeekly].filter(
    (window) => window != null
  )
  if (!windows.length) {
    return null
  }
  let headroom = 100
  for (const window of windows) {
    if (
      !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 ||
      window.usedPercent >= 100 ||
      (window.resetsAt !== null && (!Number.isFinite(window.resetsAt) || window.resetsAt <= now))
    ) {
      return null
    }
    headroom = Math.min(headroom, 100 - window.usedPercent)
  }
  return headroom
}

export function rankStructuredAccountCandidates(
  snapshot: AccountsSnapshot,
  agent: 'claude' | 'codex',
  now: number
) {
  const roster = snapshot[agent]
  const state = snapshot.rateLimits
  const target = agent === 'claude' ? state.claudeTarget : state.codexTarget
  const activeId = roster.activeAccountIdsByRuntime
    ? roster.activeAccountIdsByRuntime.host
    : roster.activeAccountId
  const inactive = agent === 'claude' ? state.inactiveClaudeAccounts : state.inactiveCodexAccounts
  return roster.accounts.flatMap((account) => {
    if (
      ('managedAuthRuntime' in account && account.managedAuthRuntime === 'wsl') ||
      ('managedHomeRuntime' in account && account.managedHomeRuntime === 'wsl') ||
      ('needsSignIn' in account && account.needsSignIn)
    ) {
      return []
    }
    const entry = inactive.find((item) => item.accountId === account.id)
    const usage =
      account.id === activeId
        ? target.runtime === 'host' && target.wslDistro === null
          ? state[agent]
          : null
        : entry?.isFetching
          ? null
          : entry?.rateLimits
    if (usage?.provider !== agent) {
      return []
    }
    const headroom = availableHeadroom(usage, now)
    return headroom === null
      ? []
      : [{ accountId: account.id, headroom, updatedAt: usage.updatedAt }]
  })
}

/** Replay uses the persisted home even if the roster or usage changed after commit. */
export async function prepareStructuredAccountAllocation(input: {
  runtime: Pick<
    OrcaRuntimeService,
    'getRuntimeId' | 'refreshAccountsForMobileSubscriber' | 'getAccountsSnapshot'
  >
  host: { deps: { store: Pick<StructuredAgentSessionHost['deps']['store'], 'getRecord'> } }
  sessionId: string
  agent: string
}): Promise<{
  managedAccountId?: string
  pinnedAccountHome?: AgentSessionAccountHome
  committed: () => void
}> {
  if (input.agent !== 'claude' && input.agent !== 'codex') {
    throw new Error('Automatic account allocation is supported for Claude and Codex.')
  }
  const record = input.host.deps.store.getRecord(input.sessionId)
  if (record) {
    return { pinnedAccountHome: record.accountHome, committed: () => {} }
  }
  await input.runtime.refreshAccountsForMobileSubscriber()
  const candidates = rankStructuredAccountCandidates(
    input.runtime.getAccountsSnapshot(),
    input.agent,
    Date.now()
  )
  let counts = allocations.get(input.runtime)
  if (!counts) {
    counts = new Map()
    allocations.set(input.runtime, counts)
  }
  const validKeys = new Set(candidates.map((candidate) => `${input.agent}:${candidate.accountId}`))
  for (const key of counts.keys()) {
    if (key.startsWith(`${input.agent}:`) && !validKeys.has(key)) {
      counts.delete(key)
    }
  }
  const current = counts
  const score = (candidate: (typeof candidates)[number]) => {
    const previous = current.get(`${input.agent}:${candidate.accountId}`)
    const recent = previous?.updatedAt === candidate.updatedAt ? previous.count : 0
    return candidate.headroom / (recent + 1)
  }
  candidates.sort((a, b) => score(b) - score(a) || a.accountId.localeCompare(b.accountId))
  const selected = candidates[0]
  if (!selected) {
    throw new Error(
      'No saved account has recent, usable quota. Refresh account usage or choose an account explicitly.'
    )
  }
  return {
    managedAccountId: selected.accountId,
    committed: () => {
      const key = `${input.agent}:${selected.accountId}`
      const previous = current.get(key)
      current.set(key, {
        updatedAt: selected.updatedAt,
        count: (previous?.updatedAt === selected.updatedAt ? previous.count : 0) + 1
      })
    }
  }
}
