import { describe, expect, it } from 'vitest'
import type { CodexManagedAccount } from '../../shared/managed-account-types'
import { getCodexUsageAccountId } from './codex-account-usage-provenance'

function account(id: string, overrides: Partial<CodexManagedAccount> = {}): CodexManagedAccount {
  return {
    id,
    email: `${id}@example.test`,
    managedHomePath: `/managed/${id}`,
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0,
    ...overrides
  }
}

describe('Codex usage account provenance', () => {
  it('tags the resolved home, rather than the selected account', () => {
    expect(getCodexUsageAccountId([account('a'), account('b')], '/managed/b')).toBe('b')
    expect(getCodexUsageAccountId([account('a')], null)).toBeUndefined()
    expect(getCodexUsageAccountId([account('a')], '/synthetic-system')).toBeUndefined()
  })

  it('uses the existing cross-platform path comparison', () => {
    const saved = account('a', { managedHomePath: 'C:\\managed\\a' })
    expect(getCodexUsageAccountId([saved], 'c:/managed/a/')).toBe('a')
  })

  it('matches WSL aliases and legacy Windows-side copies by distro and Linux home', () => {
    const saved = account('a', {
      managedHomeRuntime: 'wsl',
      managedHomePath: 'C:\\managed\\copy',
      wslDistro: 'Ubuntu',
      wslLinuxHomePath: '/managed/a'
    })
    const other = account('b', {
      managedHomeRuntime: 'wsl',
      wslDistro: 'Debian',
      wslLinuxHomePath: '/managed/a'
    })
    expect(getCodexUsageAccountId([other, saved], '\\\\wsl$\\ubuntu\\managed\\a')).toBe('a')
    expect(getCodexUsageAccountId([saved], '\\\\wsl.localhost\\Ubuntu\\managed\\A')).toBeUndefined()
  })

  it('refuses an ambiguous home', () => {
    expect(
      getCodexUsageAccountId(
        [account('a'), account('b', { managedHomePath: '/managed/a' })],
        '/managed/a'
      )
    ).toBeUndefined()
  })
})
