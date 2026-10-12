import type { AccountsSnapshot } from './runtime-account-controller'
import type { ProviderRateLimits } from '../../shared/rate-limit-types'

export const ALLOCATION_NOW = 1_800_000_000_000
export function allocationUsage(usedPercent = 20): ProviderRateLimits {
  return {
    provider: 'codex',
    session: {
      usedPercent,
      windowMinutes: 300,
      resetsAt: ALLOCATION_NOW + 300_000,
      resetDescription: null
    },
    weekly: null,
    updatedAt: ALLOCATION_NOW,
    status: 'ok',
    error: null
  }
}
export function allocationSnapshot(): AccountsSnapshot {
  const account = {
    email: 'synthetic@example.test',
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1
  }
  return {
    claude: { accounts: [], activeAccountId: null },
    codex: {
      accounts: [
        { ...account, id: 'a' },
        { ...account, id: 'b' }
      ],
      activeAccountId: 'a'
    },
    rateLimits: {
      claude: null,
      codex: allocationUsage(),
      gemini: null,
      opencodeGo: null,
      kimi: null,
      antigravity: null,
      minimax: null,
      grok: null,
      cursor: null,
      zcode: null,
      minimaxCookieConfigured: false,
      minimaxApiKeyConfigured: false,
      opencodeGoApiKeyConfigured: false,
      grokAuthConfigured: false,
      cursorAuthConfigured: false,
      claudeTarget: { runtime: 'host', wslDistro: null },
      codexTarget: { runtime: 'host', wslDistro: null },
      inactiveClaudeAccounts: [],
      inactiveCodexAccounts: [
        {
          accountId: 'b',
          rateLimits: allocationUsage(40),
          updatedAt: ALLOCATION_NOW,
          isFetching: false
        }
      ]
    }
  }
}
