import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentHookServer } from './server'
import { PANE } from './server.test-fixtures'
import type { RemoteAgentStatusEnvelope } from './server/server-remote-envelope-normalization'

const pending: RemoteAgentStatusEnvelope = {
  paneKey: PANE,
  source: 'claude',
  launchToken: 'permission-owner',
  hostTurnRevision: '11111111-1111-4111-8111-111111111111',
  hookEventName: 'PermissionRequest',
  toolUseId: 'request-1',
  providerSession: { key: 'session_id', id: 'session-1', transcriptPath: '/host/session.jsonl' },
  agentPresence: {
    agent: 'claude',
    process: { pid: 4001, platform: 'darwin', startTime: 'birth-1' }
  },
  payload: { state: 'waiting', agentType: 'claude', prompt: 'run command', toolName: 'Bash' }
}
const result: RemoteAgentStatusEnvelope = {
  ...pending,
  hookEventName: undefined,
  claudePermissionResolved: true,
  evidenceAgeMs: 0,
  payload: { state: 'working', agentType: 'claude', prompt: 'run command' }
}

describe('Claude permission result after desktop restart', () => {
  const cleanup: (() => void)[] = []
  afterEach(() => {
    for (const dispose of cleanup.splice(0).toReversed()) {
      dispose()
    }
  })

  async function restartWith(settled: boolean, initial = pending) {
    const userDataPath = mkdtempSync(join(tmpdir(), 'claude-permission-hydration-'))
    cleanup.push(() => rmSync(userDataPath, { recursive: true, force: true }))
    const first = new AgentHookServer()
    await first.start({ env: 'production', userDataPath })
    try {
      first.ingestRemote(initial, 'ssh-owner')
      if (settled) {
        first.ingestRemote(result, 'ssh-owner')
      }
      expect(first.getStatusSnapshot()[0]?.state).toBe(settled ? 'working' : 'waiting')
      first.flushStatusPersistSync()
    } finally {
      first.stop()
    }
    const next = new AgentHookServer()
    await next.start({ env: 'production', userDataPath })
    cleanup.push(() => next.stop())
    expect(next.getStatusSnapshot()[0]?.restoredUnconfirmed).toBe(true)
    return next
  }

  it.each([false, true])(
    'reconciles the host result when saved state was settled=%s',
    async (settled) => {
      const server = await restartWith(settled)
      server.ingestRemote({ ...result, isReplay: true }, 'ssh-owner')
      expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'working' })
      expect(server.getStatusSnapshot()[0]?.restoredUnconfirmed).toBeUndefined()
      expect(server.getStatusSnapshot()[0]?.interrupted).toBeUndefined()
      expect(server.getStatusSnapshot()[0]?.turnCompletedAt).toBeUndefined()
    }
  )

  it.each([
    { launchToken: 'different-owner' },
    { toolUseId: 'different-request' },
    {
      providerSession: {
        key: 'session_id',
        id: 'other-session',
        transcriptPath: '/host/session.jsonl'
      }
    },
    {
      agentPresence: {
        agent: 'claude',
        process: { pid: 4001, platform: 'darwin', startTime: 'birth-2' }
      }
    },
    { evidenceAgeMs: undefined }
  ])('retains a saved wait on mismatched or incomplete proof: %j', async (change) => {
    const server = await restartWith(false)
    server.ingestRemote({ ...result, ...change }, 'ssh-owner')
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      restoredUnconfirmed: true
    })
    server.ingestRemote({ ...result, ...change, isReplay: true }, 'ssh-owner')
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      restoredUnconfirmed: true
    })
  })

  it.each([false, true])(
    'restores the current aggregate with retained facts, saved settled=%s',
    async (settled) => {
      const server = await restartWith(settled)
      server.ingestRemote(
        {
          ...result,
          isReplay: true,
          claudePermissionResolved: undefined,
          claudePermissionResults: [{ toolUseId: 'request-1' }],
          toolUseId: 'request-2',
          hookEventName: 'PreToolUse',
          payload: {
            state: 'working',
            agentType: 'claude',
            prompt: 'run command',
            toolName: 'Read'
          }
        },
        'ssh-owner'
      )
      expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'working', toolName: 'Read' })
      expect(server.getStatusSnapshot()[0]?.restoredUnconfirmed).toBeUndefined()
    }
  )

  it('rejects retained facts from a different saved owner', async () => {
    const server = await restartWith(false)
    server.ingestRemote(
      {
        ...result,
        isReplay: true,
        claudePermissionResolved: true,
        claudePermissionResults: [{ toolUseId: 'request-1' }],
        launchToken: 'different-owner'
      },
      'ssh-owner'
    )
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      restoredUnconfirmed: true
    })
  })

  it('requires the original saved owner even after live ingress records another owner', async () => {
    const server = await restartWith(false, { ...pending, launchToken: undefined })
    server.ingestRemote(result, 'ssh-owner')
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      restoredUnconfirmed: true
    })
  })

  it('does not let another host confirm the saved wait', async () => {
    const server = await restartWith(false)
    server.ingestRemote({ ...result, isReplay: true }, 'other-host')
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      restoredUnconfirmed: true
    })
  })

  it('does not replace saved progress with a different cached result', async () => {
    const server = await restartWith(true)
    server.ingestRemote(
      {
        ...result,
        isReplay: true,
        payload: { state: 'working', agentType: 'claude', prompt: 'other work' }
      },
      'ssh-owner'
    )
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      prompt: 'run command',
      restoredUnconfirmed: true
    })
  })
})
