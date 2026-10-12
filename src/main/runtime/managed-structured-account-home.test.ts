import { beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
import { resolveManagedStructuredAccountHome } from './managed-structured-account-home'

const router = vi.hoisted(() => ({ accountLogin: vi.fn(), prepareAccount: vi.fn() }))
vi.mock('../claude-accounts/claude-profile-installed-router', () => ({
  getClaudeProfileRouter: () => router
}))

const location = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace',
  workspaceKind: 'folder'
} as const
const settings = getDefaultSettings('/synthetic')
const base = { email: 'synthetic@example.test', createdAt: 1, updatedAt: 1, lastAuthenticatedAt: 1 }
settings.codexManagedAccounts = ['a', 'b'].map((id) => ({
  ...base,
  id,
  managedHomePath: `/synthetic/${id}`
}))
settings.claudeManagedAccounts = [
  { ...base, id: 'c', managedAuthPath: '/synthetic/c', authMethod: 'subscription-oauth' }
]
const prepareCodexHome = vi.fn(
  async ({ managedAccountId }: { managedAccountId?: string }) => `/synthetic/${managedAccountId}`
)
const input = { settings, location, launchEnv: {}, prepareCodexHome }

beforeEach(() => {
  vi.clearAllMocks()
  router.accountLogin.mockReturnValue({ email: base.email })
  router.prepareAccount.mockResolvedValue('/synthetic/c')
})

it('prepares two saved accounts concurrently without changing the default', async () => {
  const before = structuredClone(settings)
  expect(
    await Promise.all(
      ['a', 'b'].map((accountId) =>
        resolveManagedStructuredAccountHome({ ...input, agent: 'codex', accountId })
      )
    )
  ).toEqual([
    { variable: 'CODEX_HOME', path: '/synthetic/a' },
    { variable: 'CODEX_HOME', path: '/synthetic/b' }
  ])
  expect(settings).toEqual(before)
})

it('prepares a Claude account through its existing profile router', async () => {
  expect(
    await resolveManagedStructuredAccountHome({ ...input, agent: 'claude', accountId: 'c' })
  ).toEqual({ variable: 'CLAUDE_CONFIG_DIR', path: '/synthetic/c' })
  expect(router.prepareAccount).toHaveBeenCalledWith('c')
})

it('refuses unknown identities, other providers, and another execution host', async () => {
  for (const request of [
    { ...input, agent: 'codex', accountId: 'unknown' },
    { ...input, agent: 'claude', accountId: 'a' },
    { ...input, agent: 'gemini', accountId: 'a' },
    {
      ...input,
      agent: 'codex',
      accountId: 'a',
      location: { ...location, executionHostId: 'ssh:other' as const }
    }
  ]) {
    await expect(resolveManagedStructuredAccountHome(request)).rejects.toThrow()
  }
  expect(prepareCodexHome).not.toHaveBeenCalled()
  expect(router.prepareAccount).not.toHaveBeenCalled()
})

it('refuses a saved Claude account without its own login instead of borrowing the default', async () => {
  router.accountLogin.mockReturnValue(null)
  await expect(
    resolveManagedStructuredAccountHome({ ...input, agent: 'claude', accountId: 'c' })
  ).rejects.toThrow('Sign in')
  expect(router.prepareAccount).not.toHaveBeenCalled()
})

it('does not fall back to System default when explicit Codex preparation fails', async () => {
  await expect(
    resolveManagedStructuredAccountHome({
      ...input,
      agent: 'codex',
      accountId: 'a',
      prepareCodexHome: async () => null
    })
  ).rejects.toThrow('could not be prepared')
})
