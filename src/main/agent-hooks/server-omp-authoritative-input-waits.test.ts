import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer } from './server'
import { buildBody, postHookEvent } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const SESSION = {
  session_id: 'omp-input-root',
  session_file: '/home/dev/.omp/agent/sessions/omp-input-root.jsonl'
}
const SCOUT = { id: 'native-scout', agentType: 'scout', state: 'working', startedAt: 1_000 }
const REVIEWER = {
  id: 'native-reviewer',
  agentType: 'reviewer',
  state: 'working',
  startedAt: 2_000
}

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
  vi.restoreAllMocks()
})

async function post(payload: Record<string, unknown>): Promise<void> {
  const response = await postHookEvent(server, buildBody({ ...SESSION, ...payload }), '/hook/omp')
  expect(response.status).toBe(204)
}

async function requestApproval(): Promise<void> {
  await post({ hook_event_name: 'before_agent_start', prompt: 'Root request', subagents: [SCOUT] })
  await post({
    hook_event_name: 'message_end',
    role: 'assistant',
    text: 'Root progress',
    subagents: [SCOUT]
  })
  vi.setSystemTime(1_005_000)
  await post({
    hook_event_name: 'tool_approval_requested',
    tool_name: 'bash',
    reason: 'Critical pattern detected',
    subagents: [SCOUT]
  })
}

describe('authoritative OMP native input evidence', () => {
  it.each([
    { name: 'unknown', pending: {} },
    { name: 'pending', pending: { input_pending: true } },
    { name: 'string', pending: { input_pending: 'false' } },
    { name: 'null', pending: { input_pending: null } },
    { name: 'number', pending: { input_pending: 0 } }
  ])(
    'preserves an approval across a $name working snapshot while replacing the roster',
    async ({ pending }) => {
      await requestApproval()
      const blocked = server.getStatusSnapshot()[0]!
      vi.setSystemTime(1_010_000)
      await post({
        hook_event_name: 'subagents_update',
        omp_status: {
          state: 'working',
          prompt: 'Unproven busy prompt',
          tool_name: 'read',
          tool_input: { path: 'unproven.ts' },
          role: 'assistant',
          text: 'Unproven busy preview',
          ...pending
        },
        subagents: [REVIEWER]
      })
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        state: 'blocked',
        prompt: 'Root request',
        toolName: 'bash',
        toolInput: 'Critical pattern detected',
        lastAssistantMessage: 'Root progress',
        subagents: [REVIEWER],
        stateStartedAt: blocked.stateStartedAt,
        turnStartedAt: blocked.turnStartedAt,
        mainAgent: { state: 'blocked', stateStartedAt: blocked.stateStartedAt },
        receivedAt: 1_010_000
      })
    }
  )

  it('keeps a received native approval resolution through later unknown working snapshots', async () => {
    await requestApproval()
    vi.setSystemTime(1_010_000)
    await post({
      hook_event_name: 'tool_approval_resolved',
      tool_name: 'bash',
      approved: true,
      subagents: [SCOUT]
    })
    vi.setSystemTime(1_020_000)
    await post({
      hook_event_name: 'subagents_update',
      omp_status: { state: 'working', tool_name: 'read', tool_input: { path: 'approved.ts' } },
      subagents: [REVIEWER]
    })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      prompt: 'Root request',
      toolName: 'read',
      toolInput: 'approved.ts',
      lastAssistantMessage: 'Root progress',
      stateStartedAt: 1_010_000,
      turnStartedAt: 1_000_000,
      mainAgent: { state: 'working', stateStartedAt: 1_010_000 },
      subagents: [REVIEWER]
    })
  })

  it('keeps a native question and its details through pending and unknown working snapshots', async () => {
    const questions = { questions: [{ question: 'Which path?', options: ['A', 'B'] }] }
    await post({
      hook_event_name: 'subagents_update',
      omp_status: {
        state: 'waiting',
        input_pending: true,
        prompt: 'Root request',
        tool_name: 'ask',
        tool_input: questions,
        role: 'assistant',
        text: 'Root question progress'
      },
      subagents: [SCOUT]
    })
    for (const inputPending of [true, undefined]) {
      vi.setSystemTime(Date.now() + 10_000)
      await post({
        hook_event_name: 'subagents_update',
        omp_status: {
          state: 'working',
          input_pending: inputPending,
          prompt: 'Unproven busy prompt',
          tool_name: 'bash',
          tool_input: { command: 'unproven command' },
          role: 'assistant',
          text: 'Unproven busy preview'
        },
        subagents: [REVIEWER]
      })
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        state: 'waiting',
        prompt: 'Root request',
        toolName: 'ask',
        interactivePrompt: JSON.stringify(questions),
        lastAssistantMessage: 'Root question progress',
        stateStartedAt: 1_000_000,
        mainAgent: { state: 'waiting', stateStartedAt: 1_000_000 },
        subagents: [REVIEWER]
      })
      expect(server.getStatusSnapshot()[0]?.turnStartedAt).toBeUndefined()
    }
    vi.setSystemTime(1_030_000)
    await post({
      hook_event_name: 'subagents_update',
      omp_status: {
        state: 'working',
        input_pending: false,
        tool_name: 'ask',
        role: 'assistant',
        text: 'Question answered'
      },
      subagents: []
    })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'working',
      prompt: 'Root request',
      toolName: 'ask',
      lastAssistantMessage: 'Question answered',
      stateStartedAt: 1_030_000,
      mainAgent: { state: 'working', stateStartedAt: 1_030_000 }
    })
    expect(server.getStatusSnapshot()[0]?.interactivePrompt).toBeUndefined()
    expect(server.getStatusSnapshot()[0]?.subagents).toBeUndefined()
  })

  it('retires a previous approval on a proven new identity even before native input state is known', async () => {
    await requestApproval()
    vi.setSystemTime(1_010_000)
    await post({
      session_id: 'new-native-root',
      session_file: '/home/dev/.omp/agent/sessions/new-native-root.jsonl',
      hook_event_name: 'subagents_update',
      omp_status: { state: 'working', session_boundary: true },
      subagents: [REVIEWER]
    })
    const [row] = server.getStatusSnapshot()
    expect(row).toMatchObject({
      state: 'working',
      prompt: '',
      mainAgent: { state: 'working', stateStartedAt: 1_010_000 },
      stateStartedAt: 1_010_000,
      subagents: [REVIEWER],
      providerSession: {
        id: 'new-native-root',
        transcriptPath: '/home/dev/.omp/agent/sessions/new-native-root.jsonl'
      }
    })
    expect(row?.turnStartedAt).toBeUndefined()
    expect(row?.sessionBoundary).toBeUndefined()
    expect(row?.toolName).toBeUndefined()
    expect(row?.toolInput).toBeUndefined()
    expect(row?.lastAssistantMessage).toBeUndefined()
  })
})
