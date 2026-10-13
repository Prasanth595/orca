import type { GlobalSettings } from '../../shared/global-settings-types'
import type { CodexManagedAccountSummary } from '../../shared/managed-account-types'
import type {
  ProviderRateLimits,
  RateLimitRuntimeTarget,
  RateLimitState
} from '../../shared/rate-limit-types'
import type { RateLimitService } from '../rate-limits/service'
import { DEFAULT_POLL_MS } from '../rate-limits/service/service-types'
import {
  isAccountOverAutoSwitchLine,
  pickAccountAutoSwitchTarget
} from '../accounts/account-auto-switch-policy'
import {
  getSelectedCodexAccountIdForTarget,
  normalizeCodexAccountSelectionTarget,
  normalizeCodexRuntimeSelection
} from './runtime-selection'
import type { CodexAccountService } from './service'

type CodexAutoSwitchSettings = Pick<
  GlobalSettings,
  'codexAutoSwitchEnabled' | 'activeCodexManagedAccountId' | 'activeCodexManagedAccountIdsByRuntime'
>

type CodexAutoSwitchDeps = {
  getSettings: () => CodexAutoSwitchSettings
  rateLimits: Pick<RateLimitService, 'fetchInactiveCodexAccountsOnOpen'>
  accounts: Pick<CodexAccountService, 'listAccounts' | 'autoSelectAccountForTarget'>
  onSwitched: (emails: { from: string; to: string }) => void
}

type CodexAutoSwitchDecision =
  | { kind: 'stay' }
  | { kind: 'read-usage' }
  | { kind: 'switch'; from: CodexManagedAccountSummary; to: CodexManagedAccountSummary }

const STAY: CodexAutoSwitchDecision = { kind: 'stay' }

/** Moves new Codex sessions to the managed account with the most room before a usage limit. */
export function createCodexAccountAutoSwitch(
  deps: CodexAutoSwitchDeps
): (state: RateLimitState) => void {
  let latestState: RateLimitState | null = null
  let selection = normalizeCodexRuntimeSelection(deps.getSettings())
  let lastSwitchAt = 0
  let lastUsageReadAt = 0
  let switching = false

  const decide = (state: RateLimitState, now: number): CodexAutoSwitchDecision => {
    const settings = deps.getSettings()
    const selectedId = getSelectedCodexAccountIdForTarget(settings, state.codexTarget)
    if (!settings.codexAutoSwitchEnabled || !selectedId) {
      return STAY
    }
    const accounts = deps.accounts.listAccounts().accounts
    const from = accounts.find((account) => account.id === selectedId)
    if (
      accounts.length < 2 ||
      !from ||
      // Why: mid-switch, the snapshot can still be the previous account's.
      !isReadingOf(state.codex, from) ||
      // Why: after a switch or a failed attempt, act only on a newer reading.
      (state.codex?.updatedAt ?? 0) < lastSwitchAt ||
      !isAccountOverAutoSwitchLine(state.codex, now)
    ) {
      return STAY
    }

    const candidateIds = new Set(
      accounts
        .filter((account) => account.id !== selectedId && sharesRuntime(account, from))
        .map((account) => account.id)
    )
    const usages = state.inactiveCodexAccounts.filter((usage) => candidateIds.has(usage.accountId))
    const candidates = usages.filter((usage) => now - usage.updatedAt <= DEFAULT_POLL_MS)
    // Why: an account inside its Retry-After cannot be read, so ranking does not wait for it.
    const unreadable = usages.filter(
      (usage) =>
        !candidates.includes(usage) && (usage.rateLimits?.usageMetadata?.retryAtMs ?? 0) > now
    )
    // Why: rank only once every readable candidate has a recent reading, or a read was just tried.
    if (candidates.length + unreadable.length < candidateIds.size) {
      // Why: the usage service skips a read it debounces, so only one under way counts as tried.
      if (usages.some((usage) => usage.isFetching)) {
        lastUsageReadAt = now
        return STAY
      }
      if (now - lastUsageReadAt >= DEFAULT_POLL_MS) {
        return { kind: 'read-usage' }
      }
    }
    const targetId = pickAccountAutoSwitchTarget(state.codex, candidates, { now, lastSwitchAt })
    const to = accounts.find((account) => account.id === targetId)
    return to ? { kind: 'switch', from, to } : STAY
  }

  const switchAccount = (
    from: CodexManagedAccountSummary,
    to: CodexManagedAccountSummary,
    target: RateLimitRuntimeTarget
  ): void => {
    switching = true
    // Why: the switch can wait behind a sign-in, so it re-decides on the latest usage when it runs.
    const stillWanted = (): boolean => {
      const decision = latestState ? decide(latestState, Date.now()) : STAY
      return decision.kind === 'switch' && decision.from.id === from.id && decision.to.id === to.id
    }
    deps.accounts
      .autoSelectAccountForTarget(to.id, target, stillWanted)
      .then((switched) => {
        if (switched) {
          lastSwitchAt = Date.now()
          console.info('[codex-accounts] Auto-switched account for new sessions')
          deps.onSwitched({ from: from.email, to: to.email })
        }
      })
      .catch(() => {
        lastSwitchAt = Date.now()
        console.warn('[codex-accounts] Auto-switch failed')
      })
      .finally(() => {
        switching = false
      })
  }

  return (state) => {
    latestState = state
    const now = Date.now()
    const nextSelection = normalizeCodexRuntimeSelection(deps.getSettings())
    // Manual changes in any runtime get the same cooldown, including before the first poll.
    if (
      nextSelection.host !== selection.host ||
      Object.keys({ ...selection.wsl, ...nextSelection.wsl }).some(
        (distro) => (nextSelection.wsl[distro] ?? null) !== (selection.wsl[distro] ?? null)
      )
    ) {
      lastSwitchAt = now
    }
    selection = nextSelection
    if (switching) {
      return
    }
    const decision = decide(state, now)
    if (decision.kind === 'read-usage') {
      // Why deferred: the service publishes from inside this call, and this runs mid-publish.
      queueMicrotask(() => {
        deps.rateLimits
          .fetchInactiveCodexAccountsOnOpen()
          .catch(() => console.warn('[codex-accounts] Failed to read inactive Codex usage'))
      })
    } else if (decision.kind === 'switch') {
      switchAccount(decision.from, decision.to, state.codexTarget)
    }
  }
}

function isReadingOf(
  limits: ProviderRateLimits | null,
  account: CodexManagedAccountSummary
): boolean {
  return limits?.usageMetadata?.managedAccountId === account.id
}

/** Why not the usage target: with the default WSL distro it names no distro, but accounts do. */
function sharesRuntime(a: CodexManagedAccountSummary, b: CodexManagedAccountSummary): boolean {
  const left = runtimeOf(a)
  const right = runtimeOf(b)
  return left.runtime === right.runtime && left.wslDistro === right.wslDistro
}

function runtimeOf(account: CodexManagedAccountSummary): RateLimitRuntimeTarget {
  return normalizeCodexAccountSelectionTarget({
    runtime: account.managedHomeRuntime,
    wslDistro: account.wslDistro
  })
}
