import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { AgentHookServer } from './server'
import { buildBody } from './server.test-fixtures'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const SESSION = { session_id: 'clock-root', session_file: '/sessions/clock-root.jsonl' }
const CHILD = { id: 'clock-child', agentType: 'task', state: 'working', startedAt: 900_000 }

let server: AgentHookServer

function post(payload: Record<string, unknown>): void {
  const event = normalizeHookPayload(
    server._getStateForTests(),
    'omp',
    buildBody({ ...SESSION, ...payload }),
    'production'
  )
  if (!event) {
    throw new Error('Expected normalized OMP root evidence')
  }
  server.ingestRemote(event, null)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000_000)
  server = new AgentHookServer()
  post({ hook_event_name: 'before_agent_start', prompt: 'old root turn' })
  vi.setSystemTime(1_001_000)
  post({
    hook_event_name: 'subagents_update',
    omp_status: { state: 'done' },
    subagents: [CHILD]
  })
  expect(server.getStatusSnapshot()[0]).toMatchObject({
    state: 'working',
    mainAgent: { state: 'done', stateStartedAt: 1_001_000 }
  })
})

afterEach(() => {
  server.stop()
  vi.useRealTimers()
})

describe('OMP settled root clock scope', () => {
  it('does not carry a previous root completion through a genuine new user turn', () => {
    vi.setSystemTime(1_010_000)
    post({ hook_event_name: 'before_agent_start', prompt: 'new root turn' })
    post({ hook_event_name: 'agent_start' })
    vi.setSystemTime(1_020_000)
    post({ hook_event_name: 'agent_end' })
    vi.setSystemTime(1_030_000)
    post({ hook_event_name: 'subagents_update', omp_status: { state: 'done' }, subagents: [] })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      stateStartedAt: 1_020_000,
      prompt: 'new root turn',
      mainAgent: { state: 'done', stateStartedAt: 1_020_000 }
    })
  })

  it.each([
    { session_id: 'replacement-root', session_file: '/sessions/replacement-root.jsonl' },
    { session_id: 'clock-root', session_file: '/sessions/replaced-clock-root.jsonl' }
  ])('does not borrow the old clock after an ordinary end in $session_file', (replacement) => {
    vi.setSystemTime(1_002_000)
    post({ hook_event_name: 'subagents_update', omp_status: { state: 'done' }, subagents: [] })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      stateStartedAt: 1_002_000,
      mainAgent: { state: 'done', stateStartedAt: 1_001_000 }
    })
    vi.setSystemTime(1_010_000)
    post({ ...replacement, hook_event_name: 'agent_end' })
    vi.setSystemTime(1_020_000)
    post({
      ...replacement,
      hook_event_name: 'subagents_update',
      omp_status: { state: 'done', session_boundary: true },
      subagents: []
    })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      mainAgent: { state: 'done', stateStartedAt: 1_010_000 },
      providerSession: { id: replacement.session_id, transcriptPath: replacement.session_file }
    })
  })

  it('does not attach the settled root fact to an explicit scope close', () => {
    vi.setSystemTime(1_010_000)
    post({ hook_event_name: 'agent_end', session_boundary: true })
    expect(server.getStatusSnapshot()[0]).toMatchObject({
      state: 'done',
      stateStartedAt: 1_010_000,
      sessionBoundary: true
    })
    expect(server.getStatusSnapshot()[0]?.mainAgent).toBeUndefined()
  })
})
