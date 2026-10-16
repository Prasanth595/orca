// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { ClaudeRateLimitAccountsState } from '../../../../shared/managed-account-types'
import { renderClaudeSessionMoveSetting } from './accounts-pane-claude-session-moves'

const NAME = 'Move idle sessions to the selected account'

function accounts(count: number): ClaudeRateLimitAccountsState {
  return {
    accounts: Array.from({ length: count }, (_, index) => ({
      id: `acct-${index}`,
      email: `${index}@example.test`,
      authMethod: 'subscription-oauth' as const,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    })),
    activeAccountId: null
  }
}

function renderSetting(overrides: { remote?: boolean; count?: number; on?: boolean } = {}) {
  const updateSettings = vi.fn()
  const element = renderClaudeSessionMoveSetting({
    claudeAccounts: accounts(overrides.count ?? 1),
    isRemoteAccountScope: overrides.remote ?? false,
    settings: { ...getDefaultSettings('/tmp'), claudeMoveIdleSessions: overrides.on === true },
    updateSettings
  })
  render(<>{element}</>)
  return updateSettings
}

describe('Claude session move setting', () => {
  afterEach(cleanup)

  it('turns automatic moves on', () => {
    const updateSettings = renderSetting()

    fireEvent.click(screen.getByRole('switch', { name: NAME }))

    expect(updateSettings).toHaveBeenCalledWith({ claudeMoveIdleSessions: true })
  })

  it('shows the saved choice', () => {
    renderSetting({ on: true })

    expect(screen.getByRole('switch', { name: NAME }).getAttribute('aria-checked')).toBe('true')
  })

  it("is offered only for this machine's accounts, with an account to switch to", () => {
    renderSetting({ remote: true })
    expect(screen.queryByRole('switch', { name: NAME })).toBeNull()
    cleanup()
    renderSetting({ count: 0 })
    expect(screen.queryByRole('switch', { name: NAME })).toBeNull()
  })
})
