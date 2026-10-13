import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'
import type { AgentProcessVerdict } from '../../shared/agent-process-presence'

const probe = vi.hoisted(() => vi.fn(async (): Promise<AgentProcessVerdict> => 'live'))
vi.mock('../../shared/agent-process-presence-probe', () => ({
  probeAgentProcessPresence: probe
}))
beforeEach(() => {
  probe.mockReset()
  probe.mockResolvedValue('live')
})

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).toReversed()) {
    dispose()
  }
})

async function setup(
  options: {
    noResult?: boolean
    noAuthority?: boolean
    disabled?: boolean
    parallel?: boolean
    child?: string
    resultChild?: string
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-permission-host-restart-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const transcriptPath = join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      sessionId: 'session-1',
      uuid: 'call-1',
      parentUuid: null,
      type: 'assistant',
      agentId: options.child,
      isSidechain: Boolean(options.child),
      message: {
        role: 'assistant',
        content: (options.parallel ? ['tool-1', 'tool-2'] : ['tool-1']).map((id) => ({
          type: 'tool_use',
          id,
          name: 'Bash',
          input: { command: 'pwd' }
        }))
      }
    })}\n`
  )
  const before = new AgentHookServer()
  await before.start({ env: 'production', userDataPath: dir })
  try {
    const response = await postHookEvent(
      before,
      buildBody(
        {
          hook_event_name: 'PermissionRequest',
          session_id: 'session-1',
          transcript_path: transcriptPath,
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          agent_id: options.child,
          tool_input: { command: 'pwd' }
        },
        {
          launchToken: options.noAuthority ? undefined : 'launch-1',
          agentProcess: JSON.stringify({ pid: 4001, platform: 'darwin', startTime: 'birth-1' })
        }
      )
    )
    expect(response.status).toBe(204)
    expect(before.getStatusSnapshot()[0]?.state).toBe('waiting')
    before.flushStatusPersistSync()
  } finally {
    before.stop()
  }
  if (!options.noResult) {
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        sessionId: 'session-1',
        uuid: 'result-1',
        parentUuid: 'call-1',
        type: 'user',
        agentId: options.resultChild ?? options.child,
        isSidechain: Boolean(options.resultChild ?? options.child),
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'error' }
          ]
        }
      })}\n`
    )
  }
  const after = new AgentHookServer()
  await after.start({ env: 'production', userDataPath: dir, statusHooksEnabled: !options.disabled })
  cleanup.push(() => after.stop())
  return {
    after,
    transcriptPath,
    post: async (event: Record<string, unknown>) => {
      const response = await postHookEvent(
        after,
        buildBody(
          { session_id: 'session-1', transcript_path: transcriptPath, ...event },
          {
            launchToken: 'launch-1',
            agentProcess: JSON.stringify({ pid: 4001, platform: 'darwin', startTime: 'birth-1' })
          }
        )
      )
      expect(response.status).toBe(204)
    }
  }
}

it('settles a local request completed while its execution host was down without another hook', async () => {
  const { after } = await setup()
  expect(after.getStatusSnapshot()[0]).toMatchObject({
    state: 'waiting',
    restoredUnconfirmed: true
  })
  await vi.waitFor(() => expect(after.getStatusSnapshot()[0]?.state).not.toBe('waiting'), {
    timeout: 6500,
    interval: 50
  })
  expect(after.getStatusSnapshot()[0]?.interrupted).toBeUndefined()
  expect(after.getStatusSnapshot()[0]?.turnCompletedAt).toBeUndefined()
  expect(after.getStatusSnapshot()[0]?.restoredUnconfirmed).toBe(true)
})

it.each(['unverifiable', 'exited'] as const)(
  'retains the restored wait when its process is %s',
  async (verdict) => {
    probe.mockResolvedValue(verdict)
    const { after } = await setup()
    await vi.waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 3000, interval: 50 })
    expect(after.getStatusSnapshot()[0]?.state).toBe('waiting')
  }
)

it.each([{ noResult: true }, { noAuthority: true }])(
  'does not recover without request evidence and saved authority: %j',
  async (options) => {
    const { after } = await setup(options)
    await new Promise((resolve) => setTimeout(resolve, 1400))
    expect(after.getStatusSnapshot()[0]?.state).toBe('waiting')
    expect(probe).not.toHaveBeenCalled()
  }
)

it('starts restored polling when status hooks are enabled after startup', async () => {
  const { after } = await setup({ disabled: true })
  expect(after.getStatusSnapshot()).toHaveLength(0)
  after.setStatusHooksEnabled(true)
  await vi.waitFor(() => expect(after.getStatusSnapshot()[0]?.state).toBe('working'), {
    timeout: 3000,
    interval: 50
  })
})

it('keeps identical parallel calls waiting until both have terminal results after restart', async () => {
  const { after, transcriptPath } = await setup({ parallel: true })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  expect(after.getStatusSnapshot()[0]?.state).toBe('waiting')
  expect(probe).not.toHaveBeenCalled()
  appendFileSync(
    transcriptPath,
    `${JSON.stringify({
      sessionId: 'session-1',
      uuid: 'result-2',
      parentUuid: 'result-1',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'ok' }]
      }
    })}\n`
  )
  await vi.waitFor(() => expect(after.getStatusSnapshot()[0]?.state).not.toBe('waiting'), {
    timeout: 6500,
    interval: 50
  })
})

it.each(['child-1', 'sibling'])(
  'only accepts a restored child result owned by child-1: %s',
  async (resultChild) => {
    const { after } = await setup({ child: 'child-1', resultChild })
    if (resultChild === 'child-1') {
      await vi.waitFor(() => expect(after.getStatusSnapshot()[0]?.state).not.toBe('waiting'), {
        timeout: 3000,
        interval: 50
      })
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1400))
      expect(after.getStatusSnapshot()[0]?.state).toBe('waiting')
      expect(probe).not.toHaveBeenCalled()
    }
  }
)

it.each(['new-wait', 'disable', 'teardown'] as const)(
  'rejects an in-flight restored observation after %s',
  async (change) => {
    let release!: (verdict: AgentProcessVerdict) => void
    probe.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const { after, post } = await setup()
    await vi.waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 3000, interval: 50 })
    if (change === 'new-wait') {
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Read', tool_use_id: 'tool-2' })
    } else if (change === 'disable') {
      after.setStatusHooksEnabled(false)
    } else {
      after.clearPaneState(PANE)
    }
    release('live')
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (change === 'teardown') {
      expect(after.getStatusSnapshot()).toHaveLength(0)
    } else {
      expect(after.getStatusSnapshot()[0]).toMatchObject({
        state: 'waiting',
        toolName: change === 'new-wait' ? 'Read' : 'Bash'
      })
    }
  }
)
