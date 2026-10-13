import { afterEach, describe, expect, it } from 'vitest'
import { AgentHookServer } from './server'
import { PANE } from './server.test-fixtures'
import type { RemoteAgentStatusEnvelope } from './server/server-remote-envelope-normalization'

const pending: RemoteAgentStatusEnvelope = {
  paneKey: PANE,
  source: 'claude',
  launchToken: 'launch-1',
  hostTurnRevision: '11111111-1111-4111-8111-111111111111',
  hookEventName: 'PermissionRequest',
  toolUseId: 'tool-1',
  toolAgentId: 'child-1',
  toolAgentType: 'worker',
  providerSession: { key: 'session_id', id: 'session-1', transcriptPath: '/host/session.jsonl' },
  agentPresence: {
    agent: 'claude',
    process: { pid: 4001, platform: 'darwin', startTime: 'birth-1' }
  },
  payload: { state: 'waiting', agentType: 'claude', prompt: 'work', toolName: 'Bash' }
}
const replay: RemoteAgentStatusEnvelope = {
  ...pending,
  isReplay: true,
  evidenceAgeMs: 50,
  hookEventName: 'PreToolUse',
  toolUseId: 'tool-2',
  toolAgentId: undefined,
  toolAgentType: undefined,
  claudePermissionResults: [
    { toolUseId: 'tool-1', toolAgentId: 'child-1', toolAgentType: 'worker' }
  ],
  payload: { state: 'working', agentType: 'claude', prompt: 'work', toolName: 'Read' }
}

describe('one current remote status with retained permission facts', () => {
  let server: AgentHookServer
  afterEach(() => server?.stop())

  async function setup() {
    server = new AgentHookServer()
    await server.start({ env: 'production' })
    server.ingestRemote(pending, 'ssh-owner')
  }

  it('settles the exact earlier child request while publishing the current tool', async () => {
    await setup()
    server.ingestRemote(replay, 'ssh-owner')
    expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'working', toolName: 'Read' })
  })

  it.each(['PreToolUse', 'PostToolUse', 'Stop'])(
    'unrelated facts do not suppress ordinary %s recovery',
    async (hookEventName) => {
      await setup()
      server.ingestRemote(
        {
          ...pending,
          isReplay: true,
          evidenceAgeMs: 50,
          hookEventName,
          claudePermissionResults: [{ toolUseId: 'other-request' }],
          payload: {
            state: hookEventName === 'Stop' ? 'done' : 'working',
            agentType: 'claude',
            prompt: 'work',
            toolName: 'Bash'
          }
        },
        'ssh-owner'
      )
      expect(server.getStatusSnapshot()[0]?.state).toBe(
        hookEventName === 'Stop' ? 'done' : 'working'
      )
    }
  )

  it('unrelated facts do not suppress an ordinary completion from a newer turn', async () => {
    await setup()
    server.ingestRemote(
      {
        ...replay,
        hostTurnRevision: '22222222-2222-4222-8222-222222222222',
        hookEventName: 'Stop',
        payload: { state: 'done', agentType: 'claude', prompt: 'work' }
      },
      'ssh-owner'
    )
    expect(server.getStatusSnapshot()[0]?.state).toBe('done')
  })

  it.each([
    { claudePermissionResults: undefined },
    { claudePermissionResults: [] },
    {
      claudePermissionResults: [
        { toolUseId: 'wrong-request', toolAgentId: 'child-1', toolAgentType: 'worker' }
      ]
    },
    {
      claudePermissionResults: [
        { toolUseId: 'tool-1', toolAgentId: 'other-child', toolAgentType: 'worker' }
      ]
    },
    {
      claudePermissionResults: [
        { toolUseId: 'tool-1', toolAgentId: 'child-1', toolAgentType: 'other-type' }
      ]
    },
    { claudePermissionResults: [{ toolUseId: 123 }] },
    { claudePermissionResults: Array.from({ length: 17 }, () => ({ toolUseId: 'tool-1' })) },
    { evidenceAgeMs: undefined },
    { isReplay: false },
    { hostTurnRevision: '22222222-2222-4222-8222-222222222222' },
    { hostTurnRevision: undefined },
    { launchToken: 'launch-2' },
    { providerSession: { key: 'session_id', id: 'other', transcriptPath: '/host/session.jsonl' } },
    {
      agentPresence: {
        agent: 'claude',
        process: { pid: 4001, platform: 'darwin', startTime: 'birth-2' }
      }
    }
  ] satisfies Partial<RemoteAgentStatusEnvelope>[])(
    'retains the wait for mismatched or invalid evidence: %j',
    async (change) => {
      await setup()
      server.ingestRemote({ ...replay, ...change }, 'ssh-owner')
      expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'waiting', toolName: 'Bash' })
    }
  )
})
