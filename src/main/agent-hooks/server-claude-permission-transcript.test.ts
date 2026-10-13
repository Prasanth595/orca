import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'
import { buildBody, RUNNING_SHELL } from './server.test-fixtures'
import { CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS } from '../../shared/claude-owed-task-notifications'
import { RelayAgentHookServer } from '../../wsl-guest/agent-hook-server'
import type { AgentHookRelayEnvelope } from '../../shared/agent-hook-relay'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'

const probe = vi.hoisted(() =>
  vi.fn(async (): Promise<'live' | 'unverifiable' | 'exited'> => 'live')
)
vi.mock('../../shared/agent-process-presence-probe', () => ({ probeAgentProcessPresence: probe }))
beforeEach(() => {
  probe.mockReset()
  probe.mockResolvedValue('live')
})

function callLine(id = 'tool-1'): string {
  return `${JSON.stringify({
    sessionId: 'session-1',
    uuid: `call-${id}`,
    parentUuid: null,
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'pwd' } }]
    }
  })}\n`
}
function resultLine(id = 'tool-1'): string {
  return `${JSON.stringify({
    sessionId: 'session-1',
    uuid: `result-${id}`,
    parentUuid: `call-${id}`,
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'denied' }]
    }
  })}\n`
}

describe.each(['local', 'relay'] as const)('Claude permission transcript recovery: %s', (host) => {
  const cleanup: (() => void)[] = []
  afterEach(() => {
    for (const dispose of cleanup.splice(0).toReversed()) {
      dispose()
    }
    vi.useRealTimers()
  })

  async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'claude-permission-hook-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, callLine())
    const desktop = new AgentHookServer()
    await desktop.start({ env: 'production' })
    cleanup.push(() => desktop.stop())
    const forwarded: AgentHookRelayEnvelope[] = []
    let connected = true
    const relay =
      host === 'relay'
        ? new RelayAgentHookServer({
            endpointDir: dir,
            forward: (event) => {
              forwarded.push(event)
              if (connected) {
                desktop.ingestRemote(event, 'ssh-owner')
              }
            }
          })
        : undefined
    if (relay) {
      await relay.start()
      cleanup.push(() => relay.stop())
    }
    const localEnv = desktop.buildPtyEnv()
    const coordinates = relay?.getCoordinates() ?? {
      port: localEnv.ORCA_AGENT_HOOK_PORT,
      token: localEnv.ORCA_AGENT_HOOK_TOKEN
    }
    async function post(event: Record<string, unknown>) {
      const response = await fetch(`http://127.0.0.1:${coordinates.port}/hook/claude`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Orca-Agent-Hook-Token': coordinates.token
        },
        body: JSON.stringify(
          buildBody(
            { session_id: 'session-1', transcript_path: path, ...event },
            {
              launchToken: 'launch-1',
              agentProcess: JSON.stringify({ pid: 4001, platform: 'darwin', startTime: 'birth-1' })
            }
          )
        )
      })
      expect(response.status).toBe(204)
    }
    return {
      path,
      desktop,
      post,
      relay,
      forwarded,
      setConnected: (value: boolean) => {
        connected = value
      }
    }
  }

  it.skipIf(host !== 'relay')(
    'restores a result observed during a disconnected transport',
    async () => {
      const { path, desktop, post, relay, forwarded, setConnected } = await setup()
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
      setConnected(false)
      desktop.clearStatusEntriesForConnection('ssh-owner')
      appendFileSync(path, resultLine())
      await vi.waitFor(
        () => expect(forwarded.some((event) => event.claudePermissionResolved)).toBe(true),
        { timeout: 3000, interval: 50 }
      )
      const observedBy = Date.now()
      const result = forwarded.find((event) => event.claudePermissionResolved)!
      const { evidenceAgeMs: _age, ...unaged } = result
      desktop.ingestRemote({ ...unaged, isReplay: true }, 'ssh-owner')
      expect(desktop.getStatusSnapshot()).toHaveLength(0)
      await new Promise((resolve) => setTimeout(resolve, 50))
      setConnected(true)
      expect(relay?.replayCachedPayloadsForPanes()).toBe(1)
      const restored = desktop.getStatusSnapshot()[0]
      expect(restored?.state).toBe('working')
      expect(restored?.evidenceObservedAt).toBeLessThanOrEqual(observedBy)
      expect(restored?.interrupted).toBeUndefined()
      expect(restored?.turnCompletedAt).toBeUndefined()
    }
  )

  it.skipIf(host !== 'relay').each([false, true])(
    'accepts a matching replay but rejects foreign and superseded results (facts: %s)',
    async (withFacts) => {
      const { path, desktop, post, forwarded, setConnected } = await setup()
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
      setConnected(false)
      appendFileSync(path, resultLine())
      await vi.waitFor(
        () => expect(forwarded.some((event) => event.claudePermissionResolved)).toBe(true),
        { timeout: 3000, interval: 50 }
      )
      const result = {
        ...forwarded.find((event) => event.claudePermissionResolved)!,
        ...(withFacts ? { claudePermissionResults: [{ toolUseId: 'tool-1' }] } : {})
      }
      desktop.ingestRemote(
        {
          ...result,
          agentPresence: {
            agent: 'claude',
            process: { pid: 4001, platform: 'darwin', startTime: 'replacement' }
          }
        },
        'ssh-owner'
      )
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('waiting')
      desktop.ingestRemote({ ...result, isReplay: true }, 'ssh-owner')
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('working')
      setConnected(true)
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Read', tool_use_id: 'tool-2' })
      desktop.ingestRemote({ ...result, isReplay: true }, 'ssh-owner')
      expect(desktop.getStatusSnapshot()[0]).toMatchObject({ state: 'waiting', toolName: 'Read' })
      await post({ hook_event_name: 'Stop' })
      desktop.ingestRemote({ ...result, isReplay: true }, 'ssh-owner')
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('done')
    }
  )

  it.skipIf(host !== 'relay')(
    'reconciles a settled request when a later tool hook replaces the relay cache offline',
    async () => {
      const { path, desktop, post, relay, forwarded, setConnected } = await setup()
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
      setConnected(false)
      appendFileSync(path, resultLine())
      await vi.waitFor(
        () => expect(forwarded.some((event) => event.claudePermissionResolved)).toBe(true),
        { timeout: 3000, interval: 50 }
      )
      await post({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'tool-2' })
      expect(forwarded.at(-1)?.payload).toMatchObject({ state: 'working', toolName: 'Read' })
      setConnected(true)
      relay?.replayCachedPayloadsForPanes()
      expect(desktop.getStatusSnapshot()[0]).toMatchObject({ state: 'working', toolName: 'Read' })
    }
  )

  it.skipIf(host !== 'relay')(
    'replays only the current done status with settlement facts',
    async () => {
      const { path, desktop, post, relay, forwarded, setConnected } = await setup()
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
      setConnected(false)
      appendFileSync(path, resultLine())
      await vi.waitFor(() => expect(forwarded.at(-1)?.claudePermissionResolved).toBe(true), {
        timeout: 3000,
        interval: 50
      })
      await post({ hook_event_name: 'Stop' })
      desktop.clearStatusEntriesForConnection('ssh-owner')
      const beforeReplay = forwarded.length
      setConnected(true)
      expect(relay?.replayCachedPayloadsForPanes()).toBe(1)
      const replayed = forwarded.slice(beforeReplay)
      expect(replayed).toHaveLength(1)
      expect(replayed[0]).toMatchObject({
        payload: { state: 'done' },
        claudePermissionResults: [{ toolUseId: 'tool-1' }]
      })
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('done')
    }
  )

  it.each([true, false])(
    'settles without a hook, PermissionRequest carries id=%s',
    async (hasId) => {
      const { path, desktop, post } = await setup()
      await post({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'pwd' },
        tool_use_id: 'tool-1'
      })
      await post({
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'pwd' },
        ...(hasId ? { tool_use_id: 'tool-1' } : {})
      })
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('waiting')
      appendFileSync(path, resultLine())
      await vi.waitFor(() => expect(desktop.getStatusSnapshot()[0]?.state).toBe('working'), {
        timeout: 3000,
        interval: 50
      })
      expect(desktop.getStatusSnapshot()[0]).toMatchObject({ mainAgent: { state: 'working' } })
      expect(desktop.getStatusSnapshot()[0]?.interrupted).toBeUndefined()
      expect(desktop.getStatusSnapshot()[0]?.turnCompletedAt).toBeUndefined()
      expect(desktop.getStatusSnapshot()[0]?.toolName).toBeUndefined()
    }
  )

  it.skipIf(host !== 'relay')(
    'replays the current child state after multiple offline settlements',
    async () => {
      const { path, desktop, post, relay, forwarded, setConnected } = await setup()
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
      setConnected(false)
      appendFileSync(path, resultLine())
      await vi.waitFor(() => expect(forwarded.at(-1)?.claudePermissionResolved).toBe(true), {
        timeout: 3000,
        interval: 50
      })
      await post({ hook_event_name: 'SubagentStart', agent_id: 'child-2', agent_type: 'worker' })
      await post({ hook_event_name: 'Stop' })
      await post({
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_use_id: 'tool-2',
        agent_id: 'child-2',
        agent_type: 'worker'
      })
      const rows = (callLine('tool-2') + resultLine('tool-2'))
        .trim()
        .split('\n')
        .map((line) => ({ ...JSON.parse(line), agentId: 'child-2', isSidechain: true }))
      appendFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
      await vi.waitFor(
        () =>
          expect(forwarded.at(-1)).toMatchObject({
            claudePermissionResolved: true,
            toolUseId: 'tool-2'
          }),
        { timeout: 3000, interval: 50 }
      )
      setConnected(true)
      relay?.replayCachedPayloadsForPanes()
      expect(desktop.getStatusSnapshot()[0]).toMatchObject({
        state: 'working',
        mainAgent: { state: 'done' },
        subagents: [expect.objectContaining({ id: 'child-2', state: 'working' })]
      })
    }
  )

  it('keeps a newer request waiting when the old request completes', async () => {
    const { path, desktop, post } = await setup()
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Read', tool_use_id: 'tool-2' })
    appendFileSync(path, resultLine())
    await new Promise((resolve) => setTimeout(resolve, 1400))
    expect(desktop.getStatusSnapshot()[0]).toMatchObject({ state: 'waiting', toolName: 'Read' })
    appendFileSync(path, callLine('tool-2') + resultLine('tool-2'))
    await vi.waitFor(() => expect(desktop.getStatusSnapshot()[0]?.state).toBe('working'), {
      timeout: 6500,
      interval: 50
    })
  })

  it('retries request settlement after a transient admission failure', async () => {
    const { path, desktop, relay, post } = await setup()
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each server exposes its selected private admission method; the spy injects one failure then delegates unchanged.
    const admission = (relay ?? desktop) as unknown as Record<
      'applyEvent' | 'applyNormalizedStatus',
      (event: AgentHookEventPayload, ...args: unknown[]) => unknown
    >
    const method = relay ? 'applyEvent' : 'applyNormalizedStatus'
    const apply = admission[method]
    let failed = false
    const spy = vi.spyOn(admission, method).mockImplementation((event, ...args) => {
      if (event.claudePermissionResolved && !failed) {
        failed = true
        throw new Error('temporary admission failure')
      }
      return apply.call(admission, event, ...args)
    })
    cleanup.push(() => spy.mockRestore())
    appendFileSync(path, resultLine())
    await vi.waitFor(() => expect(desktop.getStatusSnapshot()[0]?.state).toBe('working'), {
      timeout: 7500,
      interval: 50
    })
    expect(failed).toBe(true)
  }, 10000)

  it('does not mistake a parallel identical call for the permission request', async () => {
    const { path, desktop, post } = await setup()
    const parallel = {
      sessionId: 'session-1',
      uuid: 'call-tool-1',
      parentUuid: null,
      type: 'assistant',
      message: {
        role: 'assistant',
        content: ['tool-1', 'tool-2'].map((id) => ({
          type: 'tool_use',
          id,
          name: 'Bash',
          input: { command: 'pwd' }
        }))
      }
    }
    writeFileSync(path, `${JSON.stringify(parallel)}\n`)
    await post({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
      tool_use_id: 'tool-1'
    })
    await post({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' }
    })
    appendFileSync(path, resultLine())
    await new Promise((resolve) => setTimeout(resolve, 1400))
    expect(desktop.getStatusSnapshot()[0]?.state).toBe('waiting')
    appendFileSync(
      path,
      `${JSON.stringify({ ...JSON.parse(resultLine('tool-2')), parentUuid: 'result-tool-1' })}\n`
    )
    await vi.waitFor(() => expect(desktop.getStatusSnapshot()[0]?.state).toBe('working'), {
      timeout: 6500,
      interval: 50
    })
  })

  it('does not settle a replacement session from the previous session transcript', async () => {
    const { path, desktop, post } = await setup()
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
    await post({
      hook_event_name: 'PermissionRequest',
      session_id: 'session-2',
      tool_name: 'Bash',
      tool_use_id: 'tool-1'
    })
    appendFileSync(path, resultLine())
    await new Promise((resolve) => setTimeout(resolve, 1400))
    expect(desktop.getStatusSnapshot()[0]?.state).toBe('waiting')
  })

  it.each(['unverifiable', 'exited'] as const)(
    'retains the wait while its process is %s',
    async (verdict) => {
      const { path, desktop, post } = await setup()
      probe.mockResolvedValue(verdict)
      await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
      appendFileSync(path, resultLine())
      await vi.waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 3000, interval: 50 })
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('waiting')
    }
  )

  it('does not apply a delayed process probe to a newer wait', async () => {
    const { path, desktop, post } = await setup()
    let finish: (value: 'live') => void = () => {}
    probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_use_id: 'tool-1' })
    appendFileSync(path, resultLine())
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce(), { timeout: 3000, interval: 50 })
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Read', tool_use_id: 'tool-2' })
    finish('live')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(desktop.getStatusSnapshot()[0]).toMatchObject({ state: 'waiting', toolName: 'Read' })
  })

  it('restores the finished lead while keeping its permission-owning child live', async () => {
    const { path, desktop, post } = await setup()
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'work' })
    await post({ hook_event_name: 'SubagentStart', agent_id: 'child-1', agent_type: 'worker' })
    await post({ hook_event_name: 'Stop' })
    await post({
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_use_id: 'tool-1',
      agent_id: 'child-1',
      agent_type: 'worker'
    })
    const childRows = (callLine() + resultLine())
      .trim()
      .split('\n')
      .map((line) => ({ ...JSON.parse(line), agentId: 'child-1', isSidechain: true }))
    writeFileSync(path, `${childRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
    await vi.waitFor(() => expect(desktop.getStatusSnapshot()[0]?.state).toBe('working'), {
      timeout: 3000,
      interval: 50
    })
    expect(desktop.getStatusSnapshot()[0]).toMatchObject({
      mainAgent: { state: 'done' },
      subagents: [expect.objectContaining({ id: 'child-1', state: 'working' })]
    })
    await post({ hook_event_name: 'SubagentStop', agent_id: 'child-1' })
    expect(desktop.getStatusSnapshot()[0]?.state).toBe('done')
  })

  it.each(host === 'relay' ? ['none', 'before', 'after'] : ['none'])(
    'still expires an owed task notification after a permission result: disconnected=%s',
    async (disconnectAt) => {
      const disconnected = disconnectAt !== 'none'
      vi.useFakeTimers({
        shouldAdvanceTime: true,
        toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance']
      })
      const { path, desktop, post, forwarded, relay, setConnected } = await setup()
      await post({ hook_event_name: 'UserPromptSubmit', prompt: 'start a shell' })
      await post({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_response: { backgroundTaskId: RUNNING_SHELL.id }
      })
      await post({ hook_event_name: 'Stop', background_tasks: [RUNNING_SHELL] })
      await post({ hook_event_name: 'UserPromptSubmit', prompt: 'thanks' })
      await post({ hook_event_name: 'Stop', background_tasks: [] })
      await post({
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_use_id: 'tool-1',
        agent_id: 'child-1',
        agent_type: 'worker'
      })
      if (disconnectAt === 'before') {
        setConnected(false)
      }
      const row = () => (disconnected ? forwarded.at(-1)?.payload : desktop.getStatusSnapshot()[0])
      const rows = (callLine() + resultLine())
        .trim()
        .split('\n')
        .map((line) => ({ ...JSON.parse(line), agentId: 'child-1', isSidechain: true }))
      writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
      await vi.waitFor(
        () =>
          expect(row()).toMatchObject({
            state: 'working',
            mainAgent: { state: 'done' }
          }),
        { timeout: 3000, interval: 50 }
      )
      expect(row()?.claudeTaskWakeupPending).toBe('notification')
      const originalResult = forwarded.at(-1)
      const observedBy = Date.now()
      if (disconnectAt === 'after') {
        expect(desktop.getStatusSnapshot()[0]?.state).toBe('working')
        setConnected(false)
      }
      await vi.advanceTimersByTimeAsync(CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS)
      expect(row()?.claudeTaskWakeupPending).toBeUndefined()
      if (disconnected) {
        setConnected(true)
        expect(relay?.replayCachedPayloadsForPanes()).toBe(1)
      }
      expect(desktop.getStatusSnapshot()[0]?.state).toBe('working')
      expect(desktop.getStatusSnapshot()[0]?.claudeTaskWakeupPending).toBeUndefined()
      if (originalResult) {
        expect(desktop.getStatusSnapshot()[0]?.evidenceObservedAt).toBeLessThanOrEqual(observedBy)
        desktop.ingestRemote(
          {
            ...originalResult,
            isReplay: true,
            evidenceAgeMs: CLAUDE_OWED_TASK_NOTIFICATION_LEASE_MS
          },
          'ssh-owner'
        )
        expect(desktop.getStatusSnapshot()[0]?.claudeTaskWakeupPending).toBeUndefined()
      }
    }
  )
})
