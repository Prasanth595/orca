import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type {
  CodexManagedAccountSummary,
  CodexRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import { i18n } from '../../i18n/i18n'
import { useAppStore } from '../../store'
import { renderCodexAccountsSection } from './accounts-pane-codex-section'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

function account(
  id: string,
  email: string,
  overrides: Partial<CodexManagedAccountSummary> = {}
): CodexManagedAccountSummary {
  return {
    id,
    email,
    managedHomeRuntime: 'host',
    wslDistro: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function render(
  state: Partial<CodexRateLimitAccountsState> = {},
  settings: Partial<GlobalSettings> = {},
  remote = false
): string {
  const codexAccounts: CodexRateLimitAccountsState = {
    accounts: [],
    activeAccountId: null,
    ...state
  }
  const accountRuntime = { runtime: 'host' as const, wslDistro: null, label: 'This device' }
  const model: AccountsPaneSectionModel = {
    updateSettings: vi.fn(),
    accountOwner: { kind: 'local' },
    searchQuery: '',
    recordFeatureInteraction: vi.fn(),
    wslSupportedPlatform: false,
    wslAvailable: false,
    wslDistros: [],
    localAccountRuntime: accountRuntime,
    localAccountRuntimeSentenceLabel: 'this device',
    remoteServerName: null,
    codexAccounts,
    codexAction: 'idle',
    visibleCodexAccounts: codexAccounts.accounts,
    systemCodexActive: true,
    systemCodexNeedsSignIn: false,
    systemCodexMissingSignIn: false,
    systemCodexIdentity: undefined,
    activeCodexAuthWarning: null,
    activeCodexAccountId: null,
    codexConfigSync: null,
    codexConfigSyncWarning: null,
    codexRateLimits: null,
    codexRateLimitTarget: { runtime: 'host', wslDistro: null },
    setRemoveCodexTarget: vi.fn(),
    runCodexAccountAction: vi.fn(async () => {}),
    recordOpenCodeSettingEdit: vi.fn(),
    miniMaxRateLimits: null,
    miniMaxApiKeyDraft: '',
    setMiniMaxApiKeyDraft: vi.fn(),
    miniMaxApiKeyConfigured: false,
    miniMaxApiKeyProtection: null,
    saveMiniMaxApiKey: vi.fn(async () => {}),
    clearMiniMaxApiKey: vi.fn(async () => {}),
    miniMaxCookieDraft: '',
    setMiniMaxCookieDraft: vi.fn(),
    miniMaxConfigured: false,
    miniMaxCookieProtection: null,
    miniMaxCredentialBusy: false,
    saveMiniMaxCookie: vi.fn(async () => {}),
    clearMiniMaxCookie: vi.fn(async () => {}),
    accountRuntime,
    accountRuntimeSentenceLabel: 'this device',
    accountRuntimeUnavailable: false,
    accountVisibilityOptions: { remoteOwner: false, ownerPlatform: 'darwin' },
    claudeAccounts: { accounts: [], activeAccountId: null },
    claudeAction: 'idle',
    isRemoteAccountScope: remote,
    remoteAccountScopeNotice: null,
    runClaudeAccountAction: vi.fn(async () => {}),
    setRemoveClaudeTarget: vi.fn(),
    settings: { ...getDefaultSettings('/tmp'), ...settings },
    systemClaudeActive: codexAccounts.activeAccountId === null,
    visibleClaudeAccounts: [],
    wslCapabilitiesLoading: false
  }
  return renderToStaticMarkup(React.createElement(() => renderCodexAccountsSection(model)))
}

describe('Codex accounts auto-switch setting', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useAppStore.setState({ settingsSearchQuery: '', runtimeEnvironments: [] })
  })

  it('offers auto-switching only with two or more managed Codex accounts', () => {
    expect(render()).not.toContain('Switch accounts before a usage limit')
    expect(render({ accounts: [account('a', 'a@example.test')] })).not.toContain(
      'Switch accounts before a usage limit'
    )
    const two = render(
      { accounts: [account('a', 'a@example.test'), account('b', 'b@example.test')] },
      { codexAutoSwitchEnabled: true }
    )
    expect(two).toContain('Switch accounts before a usage limit')
    expect(two).toMatch(
      /aria-label="Switch accounts before a usage limit"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="Switch accounts before a usage limit"/
    )
  })

  it('hides the local toggle when displaying remote accounts', () => {
    const state = { accounts: [account('a', 'a@example.test'), account('b', 'b@example.test')] }
    expect(render(state, {}, true)).not.toContain('Switch accounts before a usage limit')
  })

  it('defaults to off', () => {
    const markup = render({
      accounts: [account('a', 'a@example.test'), account('b', 'b@example.test')]
    })
    expect(markup).toMatch(
      /aria-label="Switch accounts before a usage limit"[^>]*aria-checked="false"|aria-checked="false"[^>]*aria-label="Switch accounts before a usage limit"/
    )
  })
})
