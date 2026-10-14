import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH,
  AGENT_STATUS_MAX_FIELD_LENGTH,
  AGENT_STATUS_TOOL_INPUT_MAX_LENGTH
} from '../../shared/agent-status-types'
import { AgentHookServer, agentHookServer, _internals } from './server'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

beforeEach(() => {
  _internals.resetCachesForTests()
  trackMock.mockReset()
  getCohortAtEmitMock.mockReset()
  getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Pi hook normalization', () => {
  it('carries the model an OMP post stamps on the pane status', () => {
    const started = _internals.normalizeHookPayload(
      'omp',
      buildBody({
        hook_event_name: 'before_agent_start',
        prompt: 'status for omp',
        model: 'deepseek/deepseek-v4-pro',
        model_switch_command: 'orca-model'
      }),
      'production'
    )
    expect(started?.payload).toMatchObject({
      state: 'working',
      agentType: 'omp',
      model: 'deepseek/deepseek-v4-pro',
      modelSwitchCommand: 'orca-model'
    })

    // Pi posts carry no model, and none is invented for them.
    const pi = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'before_agent_start', prompt: 'status for pi' }),
      'production'
    )
    expect(pi?.payload.model).toBeUndefined()
  })

  it('model_select re-emits the last OMP status under the new model', () => {
    const started = _internals.normalizeHookPayload(
      'omp',
      buildBody({
        hook_event_name: 'agent_end',
        prompt: 'status for omp',
        model: 'deepseek/deepseek-v4-pro'
      }),
      'production'
    )
    expect(started).not.toBeNull()
    if (!started) {
      throw new Error('expected OMP agent_end to normalize')
    }
    agentHookServer.ingestRemote(
      {
        paneKey: started.paneKey,
        tabId: started.tabId,
        worktreeId: started.worktreeId,
        payload: started.payload
      },
      'conn-1'
    )

    const switched = _internals.normalizeHookPayload(
      'omp',
      buildBody({ hook_event_name: 'model_select', model: 'minimax-cn/MiniMax-M3' }),
      'production'
    )
    // Why: a switch between turns changes the model, never the state or the prompt.
    expect(switched?.payload).toMatchObject({
      state: 'done',
      prompt: 'status for omp',
      agentType: 'omp',
      model: 'minimax-cn/MiniMax-M3'
    })
  })

  it('model_select before any status has nothing to describe', () => {
    expect(
      _internals.normalizeHookPayload(
        'omp',
        buildBody({ hook_event_name: 'model_select', model: 'minimax-cn/MiniMax-M3' }),
        'production'
      )
    ).toBeNull()
    expect(
      _internals.normalizeHookPayload(
        'omp',
        buildBody({ hook_event_name: 'model_select' }),
        'production'
      )
    ).toBeNull()
  })

  it('before_agent_start maps to working and captures the prompt', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'before_agent_start', prompt: 'rename this fn' }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.agentType).toBe('pi')
    expect(result?.payload.prompt).toBe('rename this fn')
  })

  it('OMP uses Pi-compatible events but keeps OMP agent attribution', () => {
    const started = _internals.normalizeHookPayload(
      'omp',
      buildBody({ hook_event_name: 'before_agent_start', prompt: 'status for omp' }),
      'production'
    )
    expect(started?.payload).toMatchObject({
      state: 'working',
      prompt: 'status for omp',
      agentType: 'omp'
    })

    const done = _internals.normalizeHookPayload(
      'omp',
      buildBody({ hook_event_name: 'agent_end' }),
      'production'
    )
    expect(done?.payload).toMatchObject({
      state: 'done',
      prompt: 'status for omp',
      agentType: 'omp'
    })
  })

  it('agent_start without a prompt keeps the cached prompt from the current turn', () => {
    _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'before_agent_start', prompt: 'first prompt' }),
      'production'
    )
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'agent_start' }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.prompt).toBe('first prompt')
  })

  it('before_agent_start clears the previous turn’s tool cache', () => {
    _internals.normalizeHookPayload(
      'pi',
      buildBody({
        hook_event_name: 'tool_call',
        tool_name: 'bash',
        tool_input: { command: 'ls' }
      }),
      'production'
    )
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'before_agent_start', prompt: 'next' }),
      'production'
    )
    expect(result?.payload.toolName).toBeUndefined()
    expect(result?.payload.toolInput).toBeUndefined()
  })

  it('tool_call surfaces tool_name + tool_input preview', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({
        hook_event_name: 'tool_call',
        tool_name: 'bash',
        tool_input: { command: 'pnpm test' }
      }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.toolName).toBe('bash')
    expect(result?.payload.toolInput).toBe('pnpm test')
  })

  it('tool_execution_start also populates the tool preview', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({
        hook_event_name: 'tool_execution_start',
        tool_name: 'read',
        tool_input: { path: 'src/main/index.ts' }
      }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.toolName).toBe('read')
    expect(result?.payload.toolInput).toBe('src/main/index.ts')
  })

  it('message_end (assistant) stays in working but captures lastAssistantMessage', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({
        hook_event_name: 'message_end',
        role: 'assistant',
        text: 'Done — I refactored the helper.'
      }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.lastAssistantMessage).toBe('Done — I refactored the helper.')
  })

  it('message_end (user) is ignored', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'message_end', role: 'user', text: 'hi' }),
      'production'
    )
    // Why: pi captures the user prompt via before_agent_start, so a user-role message_end must not flip lastAssistantMessage.
    expect(result?.payload.lastAssistantMessage).toBeUndefined()
  })

  it('agent_end maps to done', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'agent_end' }),
      'production'
    )
    expect(result?.payload.state).toBe('done')
    expect(result?.payload.agentType).toBe('pi')
  })

  it('session_shutdown leaves a running Pi status intact', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'session_shutdown' }),
      'production'
    )
    // Why: Pi emits shutdown on reload/replace while the PTY stays alive; only agent_end proves turn completion.
    expect(result).toBeNull()
  })

  it('done preserves the cached lastAssistantMessage from a prior message_end', () => {
    _internals.normalizeHookPayload(
      'pi',
      buildBody({
        hook_event_name: 'message_end',
        role: 'assistant',
        text: 'final reply'
      }),
      'production'
    )
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'agent_end' }),
      'production'
    )
    expect(result?.payload.lastAssistantMessage).toBe('final reply')
  })

  it('unknown event names are dropped', () => {
    const result = _internals.normalizeHookPayload(
      'pi',
      buildBody({ hook_event_name: 'never_heard_of_it' }),
      'production'
    )
    expect(result).toBeNull()
  })
})

const SCOUT = { id: 'run-scout', state: 'working', startedAt: 1_000, agentType: 'scout' }
const REVIEWER = {
  id: 'run-reviewer',
  state: 'working',
  startedAt: 2_000,
  agentType: 'reviewer',
  description: 'Review the diff'
}
const OMP_SESSION = {
  session_id: 'omp-root',
  session_file: '/home/dev/.omp/agent/sessions/omp-root.jsonl'
}

describe('Pi-family child rows through the hook lane', () => {
  let server: AgentHookServer

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    server = new AgentHookServer()
    await server.start({ env: 'production' })
  })

  afterEach(() => {
    server.stop()
    vi.useRealTimers()
  })

  async function post(
    source: 'pi' | 'omp' | 'prime-agent',
    payload: Record<string, unknown>
  ): Promise<void> {
    const response = await postHookEvent(server, buildBody(payload), `/hook/${source}`)
    expect(response.status).toBe(204)
  }

  async function snapshot(
    ompStatus: unknown,
    subagents: unknown = [SCOUT],
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'subagents_update',
      omp_status: ompStatus,
      subagents,
      ...extra
    })
  }

  it.each(['pi', 'omp'] as const)(
    'publishes the %s extension roster as the row subagents',
    async (source) => {
      await post(source, {
        hook_event_name: 'before_agent_start',
        prompt: 'fan out',
        subagents: [SCOUT, REVIEWER]
      })

      expect(server.getStatusSnapshot()).toEqual([
        expect.objectContaining({
          state: 'working',
          agentType: source,
          prompt: 'fan out',
          subagents: [SCOUT, REVIEWER]
        })
      ])
    }
  )

  it('restates the last row with the new roster when a child ends between lead events', async () => {
    await post('pi', {
      hook_event_name: 'before_agent_start',
      prompt: 'fan out',
      subagents: [SCOUT, REVIEWER]
    })
    await post('pi', { hook_event_name: 'tool_execution_start', tool_name: 'bash' })
    await post('pi', { hook_event_name: 'subagents_update', subagents: [REVIEWER] })

    const [row] = server.getStatusSnapshot()
    expect(row).toMatchObject({
      state: 'working',
      prompt: 'fan out',
      toolName: 'bash',
      subagents: [REVIEWER]
    })

    // Why: the roster is a full restatement, so an update without one clears every child row.
    await post('pi', { hook_event_name: 'subagents_update' })
    expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'working', prompt: 'fan out' })
    expect(server.getStatusSnapshot()[0]?.subagents).toBeUndefined()
  })

  it('recovers an OMP parent and named children from an authoritative snapshot without a prior row', async () => {
    const promptTail = 'p'.repeat(AGENT_STATUS_MAX_FIELD_LENGTH)
    const commandTail = 'c'.repeat(AGENT_STATUS_TOOL_INPUT_MAX_LENGTH)
    const replyTail = 'r'.repeat(AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH)
    const subagents = [
      { id: 'RegistryScout', agentType: 'scout', state: 'working', startedAt: 1_000 },
      { id: 'IngressReviewer', agentType: 'reviewer', state: 'working', startedAt: 2_000 }
    ]
    const sessionId = 'omp-recovered-session'
    const sessionFile = '/home/dev/.omp/agent/sessions/omp-recovered-session.jsonl'

    expect(server.getStatusSnapshot()).toEqual([])

    // Why: a restarted receiver has missed every root lifecycle event; the snapshot must
    // restore native root evidence rather than deriving a working parent from its children.
    await post('omp', {
      hook_event_name: 'subagents_update',
      session_id: sessionId,
      session_file: sessionFile,
      omp_status: {
        state: 'blocked',
        prompt: `  Recover root\r\n${promptTail}  `,
        tool_name: 'bash',
        tool_input: { command: `  npm run\r\n${commandTail}  ` },
        role: 'assistant',
        text: `  Root approval pending\r\n\r\n\r\n${replyTail}  `
      },
      subagents
    })

    const rows = server.getStatusSnapshot()
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({
      paneKey: PANE,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      agentType: 'omp',
      state: 'blocked',
      providerSession: { key: 'session_id', id: sessionId, transcriptPath: sessionFile },
      prompt: `Recover root ${promptTail}`.slice(0, AGENT_STATUS_MAX_FIELD_LENGTH),
      toolName: 'bash',
      toolInput: `npm run ${commandTail}`.slice(0, AGENT_STATUS_TOOL_INPUT_MAX_LENGTH),
      lastAssistantMessage: `Root approval pending\n\n${replyTail}`.slice(
        0,
        AGENT_STATUS_ASSISTANT_MESSAGE_MAX_LENGTH
      ),
      subagents
    })
    expect(row?.providerSessionOnly).toBeUndefined()
  })

  it('refreshes the full OMP roster without resetting root details or host turn clocks', async () => {
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'before_agent_start',
      prompt: 'Root request',
      model: 'anthropic/claude-opus-5',
      subagents: [SCOUT, REVIEWER]
    })
    await post('omp', {
      ...OMP_SESSION,
      model: 'anthropic/claude-opus-5',
      hook_event_name: 'tool_execution_start',
      tool_name: 'bash',
      tool_input: { command: 'pnpm test' },
      subagents: [SCOUT, REVIEWER]
    })
    await post('omp', {
      ...OMP_SESSION,
      model: 'anthropic/claude-opus-5',
      hook_event_name: 'message_end',
      role: 'assistant',
      text: 'Root progress',
      subagents: [SCOUT, REVIEWER]
    })
    const before = server.getStatusSnapshot()[0]!
    trackMock.mockClear()
    vi.setSystemTime(1_010_000)
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'subagents_update',
      omp_status: { state: 'working' },
      subagents: [REVIEWER]
    })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      prompt: 'Root request',
      model: 'anthropic/claude-opus-5',
      toolName: 'bash',
      toolInput: 'pnpm test',
      lastAssistantMessage: 'Root progress',
      subagents: [REVIEWER],
      stateStartedAt: before.stateStartedAt,
      turnStartedAt: before.turnStartedAt,
      mainAgent: { state: 'working', stateStartedAt: before.stateStartedAt },
      receivedAt: 1_010_000
    })
    expect(trackMock).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
    expect(server.getStatusSnapshot()[0]?.observation?.boundary).toBeUndefined()
    await snapshot(
      {
        state: 'working',
        prompt: 'Refined root request',
        tool_name: 'read',
        tool_input: { path: 'root.ts' },
        role: 'assistant',
        text: 'Updated root progress'
      },
      []
    )
    await post('omp', { ...OMP_SESSION, hook_event_name: 'agent_end' })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      prompt: 'Refined root request',
      toolName: 'read',
      toolInput: 'root.ts',
      lastAssistantMessage: 'Updated root progress',
      turnStartedAt: before.turnStartedAt
    })
  })

  it('keeps native approval and question detail until authoritative root evidence releases it', async () => {
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'before_agent_start',
      prompt: 'Approve the change'
    })
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'tool_approval_requested',
      tool_name: 'bash',
      reason: 'Critical pattern detected'
    })
    const blocked = server.getStatusSnapshot()[0]!
    vi.setSystemTime(1_010_000)
    await snapshot({ state: 'blocked' }, [REVIEWER])
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'blocked',
      toolName: 'bash',
      toolInput: 'Critical pattern detected',
      stateStartedAt: blocked.stateStartedAt,
      turnStartedAt: blocked.turnStartedAt,
      subagents: [REVIEWER]
    })

    // Native resolution remains authoritative even when its own hook post was coalesced away.
    await snapshot({ state: 'working', input_pending: false, tool_name: 'bash', tool_input: null })
    expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'working', toolName: 'bash' })
    expect(server.getStatusSnapshot()[0]?.toolInput).toBeUndefined()
    const questions = { questions: [{ question: 'Which path?', options: ['A', 'B'] }] }
    await snapshot({ state: 'blocked', tool_name: 'ask', tool_input: questions })
    expect(server.getStatusSnapshot()[0]?.interactivePrompt).toBe(JSON.stringify(questions))
    await snapshot({ state: 'blocked' }, [REVIEWER])
    expect(server.getStatusSnapshot()[0]?.interactivePrompt).toBe(JSON.stringify(questions))
    await snapshot({ state: 'working', input_pending: false }, [])
    expect(server.getStatusSnapshot()[0]?.interactivePrompt).toBeUndefined()
  })

  it.each([
    { omp_status: null },
    { omp_status: 'working' },
    { omp_status: 1 },
    { omp_status: [] },
    { omp_status: {} },
    { omp_status: { state: 'unknown', prompt: 'spoofed' } },
    { omp_status: { state: 1 } },
    { omp_status: { state: 'working' }, session_id: undefined },
    { omp_status: { state: 'working' }, session_id: 'unsafe\u0000session' },
    { omp_status: { state: 'working' }, session_id: '-option' },
    { omp_status: { state: 'working' }, session_id: 'x'.repeat(513) },
    { omp_status: { state: 'working' }, session_file: undefined },
    { omp_status: { state: 'working' }, session_file: 1 },
    { omp_status: { state: 'working' }, session_file: 'unsafe\u0000file.jsonl' }
  ])('rejects invalid root snapshots without creating or destroying a row: %j', async (invalid) => {
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'subagents_update',
      subagents: [SCOUT],
      ...invalid
    })
    expect(server.getStatusSnapshot()).toEqual([])
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'before_agent_start',
      prompt: 'Keep this root',
      subagents: [REVIEWER]
    })
    const before = server.getStatusSnapshot()
    vi.setSystemTime(1_010_000)
    await post('omp', { ...OMP_SESSION, hook_event_name: 'subagents_update', ...invalid })
    expect(server.getStatusSnapshot()).toEqual(before)
  })

  it.each(['pi', 'prime-agent'] as const)('ignores OMP root metadata for %s', async (source) => {
    const payload = {
      ...OMP_SESSION,
      hook_event_name: 'subagents_update',
      omp_status: { state: 'blocked', prompt: 'Not the real root', session_boundary: true },
      subagents: [REVIEWER]
    }
    await post(source, payload)
    expect(server.getStatusSnapshot()).toEqual([])
    await post(source, { hook_event_name: 'before_agent_start', prompt: 'Genuine provider root' })
    await post(source, payload)
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      agentType: source,
      prompt: 'Genuine provider root',
      subagents: [REVIEWER]
    })
    expect(server.getStatusSnapshot()[0]?.mainAgent).toBeUndefined()
  })

  it.each(['session_start', 'model_select', 'unknown_snapshot'])(
    'does not accept authoritative OMP metadata on %s',
    async (hookEventName) => {
      await post('omp', {
        ...OMP_SESSION,
        hook_event_name: hookEventName,
        omp_status: { state: 'working', prompt: 'Wrong event' },
        subagents: [SCOUT]
      })
      expect(server.getStatusSnapshot()).toEqual([])
    }
  )

  it('recovers an OMP resume remnant only with valid native root evidence', async () => {
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'before_agent_start',
      prompt: 'Still executing',
      subagents: [SCOUT]
    })
    server.dropStatusEntry(PANE)
    const hidden = server.getStatusSnapshot()
    expect(hidden[0]?.providerSessionOnly).toBe(true)
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'subagents_update',
      subagents: [REVIEWER]
    })
    await snapshot({ state: 'invalid' }, [])
    expect(server.getStatusSnapshot()).toEqual(hidden)
    await snapshot({ state: 'working' }, [REVIEWER])
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      agentType: 'omp',
      state: 'working',
      prompt: 'Still executing',
      subagents: [REVIEWER]
    })
    expect(server.getStatusSnapshot()[0]?.providerSessionOnly).toBeUndefined()
  })

  it('keeps settled root evidence and clocks while explicit children hold the aggregate open', async () => {
    await post('omp', {
      ...OMP_SESSION,
      hook_event_name: 'before_agent_start',
      prompt: 'Delegate',
      subagents: [SCOUT]
    })
    vi.setSystemTime(1_010_000)
    await snapshot({ state: 'done', role: 'assistant', text: 'Root finished' })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      mainAgent: { state: 'done', stateStartedAt: 1_010_000 },
      stateStartedAt: 1_000_000,
      turnStartedAt: 1_000_000,
      lastAssistantMessage: 'Root finished',
      subagents: [SCOUT]
    })
    vi.setSystemTime(1_020_000)
    await snapshot({ state: 'done' }, [{ ...SCOUT, state: 'waiting', description: 'Child prompt' }])
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'waiting',
      mainAgent: { state: 'done', stateStartedAt: 1_010_000 },
      lastAssistantMessage: 'Root finished'
    })
    vi.setSystemTime(1_030_000)
    await snapshot({ state: 'done' }, [])
    vi.setSystemTime(1_040_000)
    await snapshot({ state: 'done' }, [])
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      mainAgent: { state: 'done', stateStartedAt: 1_010_000 },
      stateStartedAt: 1_030_000,
      turnStartedAt: 1_000_000
    })
    expect(server.getStatusSnapshot()[0]?.subagents).toBeUndefined()
  })

  it('represents a native connected-idle baseline as a boundary, not attention or a completed turn', async () => {
    await snapshot({ state: 'done', session_boundary: true }, [])
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      sessionBoundary: true,
      prompt: '',
      mainAgent: { state: 'done', stateStartedAt: 1_000_000 }
    })
    expect(server.getStatusSnapshot()[0]?.turnStartedAt).toBeUndefined()
    expect(trackMock).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
  })

  it.each(['new-id', 'new-file'] as const)(
    'rebinds an OMP %s only from a proven boundary and rejects delayed old snapshots',
    async (replacement) => {
      await post('omp', {
        ...OMP_SESSION,
        hook_event_name: 'before_agent_start',
        prompt: 'Old root'
      })
      await post('omp', {
        ...OMP_SESSION,
        hook_event_name: 'tool_execution_start',
        tool_name: 'bash',
        tool_input: { command: 'old command' }
      })
      await post('omp', {
        ...OMP_SESSION,
        hook_event_name: 'message_end',
        role: 'assistant',
        text: 'Old preview'
      })
      const before = server.getStatusSnapshot()
      const nextSession = {
        session_id: replacement === 'new-id' ? 'new-root' : OMP_SESSION.session_id,
        session_file: '/home/dev/.omp/agent/sessions/new-root.jsonl'
      }
      vi.setSystemTime(1_010_000)
      await snapshot({ state: 'working', prompt: 'Unproven root' }, [REVIEWER], nextSession)
      expect(server.getStatusSnapshot()).toEqual(before)
      await snapshot(
        { state: 'done', session_boundary: 'true', prompt: 'Still unproven' },
        [REVIEWER],
        nextSession
      )
      expect(server.getStatusSnapshot()).toEqual(before)
      await snapshot({ state: 'done', session_boundary: true }, [REVIEWER], nextSession)
      const current = server.getStatusSnapshot()
      expect(current[0]).toMatchObject({
        state: 'working',
        prompt: '',
        providerSession: {
          id: nextSession.session_id,
          transcriptPath: nextSession.session_file
        },
        subagents: [REVIEWER],
        stateStartedAt: 1_010_000,
        mainAgent: { state: 'done', stateStartedAt: 1_010_000 }
      })
      expect(current[0]?.turnStartedAt).toBeUndefined()
      expect(current[0]?.toolName).toBeUndefined()
      expect(current[0]?.toolInput).toBeUndefined()
      expect(current[0]?.lastAssistantMessage).toBeUndefined()
      vi.setSystemTime(1_020_000)
      await snapshot({ state: 'working', prompt: 'Delayed old root' })
      expect(server.getStatusSnapshot()).toEqual(current)
    }
  )

  it('keeps an update from inventing a row or unhiding a resume placeholder', async () => {
    await post('pi', { hook_event_name: 'subagents_update', subagents: [SCOUT] })
    expect(server.getStatusSnapshot()).toEqual([])

    await post('pi', {
      hook_event_name: 'session_start',
      session_id: 'pi-session-1',
      session_file: '/home/dev/.pi/agent/sessions/pi-session-1.jsonl'
    })
    await post('pi', { hook_event_name: 'subagents_update', subagents: [SCOUT] })
    const [placeholder] = server.getStatusSnapshot()
    expect(placeholder).toMatchObject({ providerSessionOnly: true, state: 'done' })
    expect(placeholder?.subagents).toBeUndefined()

    // Why: the same guard covers Pi's model_select, which shares this path.
    await post('pi', { hook_event_name: 'model_select', model: 'anthropic/claude-opus-5' })
    expect(server.getStatusSnapshot()[0]).toMatchObject({ providerSessionOnly: true })
    expect(server.getStatusSnapshot()[0]?.model).toBeUndefined()
  })

  it('records a run its session ended as a session boundary, not a completion', async () => {
    await post('pi', { hook_event_name: 'before_agent_start', prompt: 'fan out' })
    await post('pi', { hook_event_name: 'agent_end', session_boundary: true })
    expect(server.getStatusSnapshot()[0]).toMatchObject({ state: 'done', sessionBoundary: true })

    await post('pi', { hook_event_name: 'before_agent_start', prompt: 'again' })
    await post('pi', { hook_event_name: 'agent_end' })
    expect(server.getStatusSnapshot()[0]?.sessionBoundary).toBeUndefined()
  })

  it('never lets one agent restate another agent row', async () => {
    await post('pi', { hook_event_name: 'before_agent_start', prompt: 'pi turn' })
    await post('omp', { hook_event_name: 'subagents_update', subagents: [SCOUT] })
    const before = server.getStatusSnapshot()
    await snapshot({ state: 'blocked', prompt: 'Spoofed OMP root', session_boundary: true })
    expect(server.getStatusSnapshot()).toEqual(before)

    const [row] = server.getStatusSnapshot()
    expect(row).toMatchObject({ agentType: 'pi', prompt: 'pi turn' })
    expect(row?.subagents).toBeUndefined()
  })
})

// Why: publishing a roster for Pi puts its panes on the same child-work guard Claude and Codex
// already sit behind, which changes what Ctrl+C records. Pinned here so the next change to the
// guard — or to the extension, once it reports a main-agent state of its own — has to face it.
describe('a Pi cancel beside a live child row', () => {
  let server: AgentHookServer

  beforeEach(async () => {
    server = new AgentHookServer()
    await server.start({ env: 'production' })
  })

  afterEach(() => {
    server.stop()
  })

  async function startTurn(subagents?: Record<string, unknown>[]): Promise<void> {
    const response = await postHookEvent(
      server,
      buildBody({
        hook_event_name: 'before_agent_start',
        prompt: 'fan out',
        ...(subagents ? { subagents } : {})
      }),
      '/hook/pi'
    )
    expect(response.status).toBe(204)
  }

  function pressCtrlC(): boolean {
    const baseline = server.getStatusSnapshotForPane(PANE)[0]
    if (!baseline) {
      throw new Error('the pane has no row')
    }
    return server.inferInterrupt({
      paneKey: PANE,
      baselineUpdatedAt: baseline.receivedAt,
      baselineStateStartedAt: baseline.stateStartedAt,
      baselinePrompt: baseline.prompt,
      baselineAgentType: 'pi',
      intent: 'ctrl-c'
    })
  }

  it('still settles a stopped row when the pane has no children', async () => {
    await startTurn()

    expect(pressCtrlC()).toBe(true)
    expect(server.getStatusSnapshotForPane(PANE)[0]).toMatchObject({
      state: 'done',
      interrupted: true,
      mainAgent: { state: 'done', outcome: 'cancellation' }
    })
  })

  // Why: without a main-agent state from the extension, Orca cannot tell a cancelled turn from
  // Ctrl+C at the idle prompt of a lead that children alone hold open — where it cancels nothing.
  // It keeps the live row rather than claiming a cancellation the children contradict.
  it('leaves the working row alone while a child still runs', async () => {
    await startTurn([{ id: 'run-scout', state: 'working', startedAt: 1_000, agentType: 'scout' }])

    expect(pressCtrlC()).toBe(false)
    const row = server.getStatusSnapshotForPane(PANE)[0]
    expect(row).toMatchObject({
      state: 'working',
      subagents: [expect.objectContaining({ id: 'run-scout' })]
    })
    expect(row?.interrupted).toBeUndefined()
    expect(row?.mainAgent).toBeUndefined()
  })
})
