import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { decideAgentLaunchMode } from '../agent-launch/agent-launch-mode'
import { createProviderSpawnSpec } from '../provider-process/provider-process-supervisor'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import { structuredAgentRuntimeRegistration } from '../runtime/structured-agent-runtime-registrations'
import { createAcpStructuredLaunchResolver } from '../runtime/structured-agent-launch-composition.test-support'
import { GENERIC_ACP_DIALECT } from './acp-dialects/acp-dialect'
import { acpLaunchSpecFor } from './acp-launch-specs'

const DSH = acpLaunchSpecFor('dsh')!
const ACCOUNT = join(homedir(), 'dsh-work-account')

function launch(fullAccess: boolean, launchEnv: Record<string, string> = {}) {
  const record = {
    ...agentSessionRecordFixture(),
    provider: 'dsh',
    providerHandleChain: [],
    accountHome: { variable: 'DSH_HOME', path: ACCOUNT }
  }
  const resolve = createAcpStructuredLaunchResolver(DSH, {
    store: { getRecord: () => record, pinLaunchDirectory: vi.fn() },
    readJournal: () => null,
    resolveWorkspacePath: async () => join(homedir(), 'project folder'),
    resolveEnvironment: async () => ({ PATH: '/fixture/bin', USERPROFILE: homedir() }),
    resolveLaunchEnv: () => launchEnv,
    resolveFullAccess: () => fullAccess,
    resolveCommand: (command) => join(homedir(), 'cli bin', command),
    inheritedEnv: {}
  })
  return resolve({
    identity: {
      sessionId: record.sessionId,
      workspaceId: record.location.workspaceId,
      hostId: record.location.executionHostId,
      agent: 'dsh',
      providerHandle: null
    }
  })
}

describe('DeepSeek Harness ACP registration and launch', () => {
  it('uses the generic adapter capabilities without inventing interactive controls', () => {
    const registration = structuredAgentRuntimeRegistration('dsh')!
    expect(DSH.dialect).toBe(GENERIC_ACP_DIALECT)
    expect(registration.definition).toMatchObject({
      agent: 'dsh',
      handleTransport: 'acp',
      accountHomeVariable: 'DSH_HOME',
      capabilities: {
        rewind: false,
        compact: false,
        threadGoal: false,
        contextUsage: true,
        imagePrompts: true,
        steering: 'queue',
        approvalEnforcement: 'orca'
      }
    })
    expect(registration.transcriptImport).toBeNull()
    expect(registration.sessionHistory.rowAgents).toEqual([])
    expect(DSH.modelDiscovery.kind).toBe('unavailable')
    expect(DSH.loginCommand).toEqual([])
    expect(registration.definition.restingOptions.acceptsKey('effort')).toBe(true)
  })

  it.each([false, true])('launches dsh --profile acp (full access: %s)', async (fullAccess) => {
    const resolved = await launch(fullAccess, {
      DEEPSEEK_API_KEY: 'fixture-key',
      DSH_HOME: join(homedir(), 'different-account'),
      DSH_AGENTS_HOME: join(homedir(), 'agent-config')
    })
    expect(resolved).toMatchObject({
      command: join(homedir(), 'cli bin', 'dsh'),
      args: ['--profile', 'acp'],
      env: { DSH_HOME: ACCOUNT, DEEPSEEK_API_KEY: 'fixture-key' },
      fullAccess,
      resume: null
    })
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const child = createProviderSpawnSpec(resolved, { DSH_HOME: '/other' }, platform)
      expect(child.env.DSH_HOME).toBe(ACCOUNT)
      expect(child.env.DSH_AGENTS_HOME).toBe(join(homedir(), 'agent-config'))
      expect(child.args.slice(-2)).toEqual(['--profile', 'acp'])
    }
  })

  it('pins the configured absolute DSH_HOME, else the host default', async () => {
    await expect(DSH.account.resolve({ launchEnv: { DSH_HOME: ACCOUNT } })).resolves.toEqual({
      variable: 'DSH_HOME',
      path: ACCOUNT
    })
    for (const override of ['', 'relative/account']) {
      await expect(DSH.account.resolve({ launchEnv: { DSH_HOME: override } })).resolves.toEqual({
        variable: 'DSH_HOME',
        path: join(homedir(), '.dsh')
      })
    }
    expect(() => DSH.account.environment({ variable: 'GROK_HOME', path: ACCOUNT }, {})).toThrow(
      /pin DSH_HOME/
    )
  })

  it.each(['folder', 'git-worktree', 'floating'] as const)(
    'honours the Chat UI preference for a %s workspace',
    (workspaceKind) => {
      const placement = { agent: 'dsh', workspaceKind }
      expect(
        decideAgentLaunchMode({ placement, settings: { experimentalNativeChat: true } }).mode
      ).toBe('structured')
      expect(
        decideAgentLaunchMode({ placement, settings: { experimentalNativeChat: false } }).mode
      ).toBe('terminal')
    }
  )

  it('uses the existing execution-host rule, including WSL and SSH restrictions', () => {
    const registration = structuredAgentRuntimeRegistration('dsh')!
    const local = {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    } as const
    expect(registration.supportsLocation(local)).toBe(
      supportsSupervisedProviderChildLocation(local)
    )
    expect(registration.supportsLocation({ ...local, wslDistro: 'Ubuntu' })).toBe(false)
    expect(registration.supportsLocation({ ...local, executionHostId: 'ssh:box' })).toBe(false)
  })
})
