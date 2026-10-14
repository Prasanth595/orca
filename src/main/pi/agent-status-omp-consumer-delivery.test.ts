import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { AgentHookServer } from '../agent-hooks/server'
import { PANE, type Body } from '../agent-hooks/server.test-fixtures'
import {
  NATIVE_TIME,
  createNativeFixture,
  nativeChild,
  nativeRoot
} from './agent-status-extension-omp-registry-fixture'
import type { AgentStatusExtensionHarness } from './agent-status-extension-test-harness'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const CONSUMER_ENV = {
  ORCA_AGENT_HOOK_ENV: 'production',
  ORCA_PANE_KEY: PANE,
  ORCA_WORKTREE_ID: 'wt-1',
  ORCA_AGENT_LAUNCH_TOKEN: undefined
}

function consumerRow(server: AgentHookServer): AgentStatusIpcPayload {
  const row = server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
  if (!row) {
    throw new Error('Expected the native OMP hook consumer row')
  }
  return row
}

function connectConsumer(harness: AgentStatusExtensionHarness, server: AgentHookServer): void {
  harness.fetchMock.mockImplementation(async (_url, request) => {
    const body: Body = JSON.parse(String(request?.body))
    const event = normalizeHookPayload(server._getStateForTests(), 'omp', body, 'production')
    if (event) {
      server.ingestRemote(event, null)
    }
    return { ok: true }
  })
}

describe('native OMP delivery consumer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each(['omp', 'pi'] as const)(
    'keeps the %s root completion clock through agent_end and the final native snapshot',
    async (kind) => {
      const server = new AgentHookServer()
      const root = nativeRoot('root-clock', true)
      const child = nativeChild('ClockChild', root.file)
      const fixture = createNativeFixture(root, [child], {
        runtime: { kind, argv: ['bun', '/opt/omp/bin/omp'] },
        env: CONSUMER_ENV
      })
      connectConsumer(fixture.harness, server)
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'Finish with a child' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        root.ref.status = 'idle'
        root.session.isStreaming = false
        await fixture.harness.callHook('agent_end', {}, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        const held = consumerRow(server)
        expect(held).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })
        const rootDoneAt = held.mainAgent?.stateStartedAt
        if (typeof rootDoneAt !== 'number') {
          throw new Error('Expected the root completion clock')
        }
        expect(rootDoneAt).toBeGreaterThan(NATIVE_TIME)
        expect(held.turnCompletedAt).toBeUndefined()

        await vi.advanceTimersByTimeAsync(4_000)
        fixture.setStatus(child, 'idle')
        await vi.advanceTimersByTimeAsync(1_000)
        const completed = consumerRow(server)
        expect(completed).toMatchObject({
          state: 'done',
          mainAgent: { state: 'done', stateStartedAt: rootDoneAt },
          providerSession: { id: 'root-clock', transcriptPath: root.file }
        })
        expect(completed.stateStartedAt).toBeGreaterThan(rootDoneAt)
        expect(completed.subagents ?? []).toEqual([])
        const posts = fixture.harness.fetchMock.mock.calls.map((call) => {
          const body: Body = JSON.parse(String(call[1]?.body))
          return body.payload
        })
        const completionIndex = posts.findIndex(
          (payload) => payload.hook_event_name === 'agent_end'
        )
        expect(completionIndex).toBeGreaterThanOrEqual(0)
        expect(posts[completionIndex + 1]).toMatchObject({
          hook_event_name: 'subagents_update',
          omp_status: { state: 'done' },
          subagents: []
        })
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        server.stop()
      }
    }
  )
})
