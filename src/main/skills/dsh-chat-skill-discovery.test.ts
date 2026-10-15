import { describe, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { discoverDshChatSkills } from './dsh-chat-skill-discovery'
import { discoverDshSkills } from './dsh-skill-discovery'

vi.mock('./dsh-skill-discovery', () => ({
  discoverDshSkills: vi.fn(async () => ({ skills: [], sources: [], scannedAt: 1 }))
}))

describe('DSH skill discovery account and host ownership', () => {
  it('uses the pinned home and launch directory instead of a later environment/account selection', async () => {
    const record = {
      ...agentSessionRecordFixture(),
      provider: 'dsh',
      accountHome: { variable: 'DSH_HOME', path: '/accounts/pinned' },
      launchDirectory: '/workspace/pinned'
    }
    await discoverDshChatSkills({
      record,
      cwd: '/other',
      launchEnv: { DSH_HOME: '/accounts/other' }
    })
    expect(discoverDshSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/workspace/pinned',
        dshHome: '/accounts/pinned'
      })
    )
  })

  it('refuses missing sessions, other agents, foreign homes, and direct SSH/WSL locations', () => {
    const base = agentSessionRecordFixture()
    const dsh = {
      ...base,
      provider: 'dsh',
      accountHome: { variable: 'DSH_HOME', path: '/account' }
    }
    for (const record of [
      null,
      base,
      { ...dsh, accountHome: base.accountHome },
      { ...dsh, location: { ...base.location, executionHostId: 'ssh:box' as const } },
      { ...dsh, location: { ...base.location, wslDistro: 'Ubuntu' } }
    ]) {
      expect(() => discoverDshChatSkills({ record, cwd: '/workspace', launchEnv: {} })).toThrow()
    }
  })
})
