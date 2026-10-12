import type { InactiveAccountUsage } from '../../../../shared/rate-limit-types'
import type { ProviderAccountsSnapshot } from '@/runtime/runtime-provider-accounts-client'
import {
  getProviderAccountActiveIdForView,
  type ProviderAccountRuntimeView
} from './provider-account-visibility'

export function accountUsageReading(
  snapshot: ProviderAccountsSnapshot | null | undefined,
  provider: 'claude' | 'codex',
  accountId: string | null,
  runtime: ProviderAccountRuntimeView
): InactiveAccountUsage | null {
  if (!snapshot?.rateLimits || snapshot.failedProviders?.includes(provider)) {
    return null
  }
  const state = snapshot.rateLimits
  const target = provider === 'claude' ? state.claudeTarget : state.codexTarget
  const activeId = getProviderAccountActiveIdForView(snapshot[provider], runtime)
  if (accountId === activeId) {
    // A server can list several WSL slots while polling just one of them.
    if (
      target.runtime !== runtime.runtime ||
      (runtime.runtime === 'wsl' && target.wslDistro !== runtime.wslDistro)
    ) {
      return null
    }
    const limits = state[provider]
    return {
      accountId: accountId ?? '',
      rateLimits: limits,
      updatedAt: limits?.updatedAt ?? 0,
      isFetching: limits?.status === 'fetching'
    }
  }
  if (!accountId) {
    return null
  }
  const accounts =
    provider === 'claude' ? state.inactiveClaudeAccounts : state.inactiveCodexAccounts
  return accounts.find((account) => account.accountId === accountId) ?? null
}
