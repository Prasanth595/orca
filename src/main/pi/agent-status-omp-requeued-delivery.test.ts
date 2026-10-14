import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { AgentHookServer } from '../agent-hooks/server'
import { PANE, type Body } from '../agent-hooks/server.test-fixtures'
import {
  NATIVE_TIME,
  createNativeFixture,
  nativeRoot
} from './agent-status-extension-omp-registry-fixture'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

describe('OMP requeued in-flight completion settlement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each(['omp', 'pi'] as const)(
    'settles the exact %s completion object without losing a close queued ahead of it',
    async (kind) => {
      const server = new AgentHookServer()
      const root = nativeRoot('queued-A', true)
      const fixture = createNativeFixture(root, [], {
        runtime: { kind, argv: ['bun', '/opt/omp/bin/omp'] },
        env: {
          ORCA_AGENT_HOOK_ENV: 'production',
          ORCA_PANE_KEY: PANE,
          ORCA_WORKTREE_ID: 'wt-1',
          ORCA_AGENT_LAUNCH_TOKEN: undefined
        }
      })
      const accepted: Body[] = []
      let inFlight: PromiseWithResolvers<void> | undefined
      fixture.harness.fetchMock.mockImplementation(async (_url, request) => {
        const body: Body = JSON.parse(String(request?.body))
        if (
          !inFlight &&
          body.payload.hook_event_name === 'agent_end' &&
          body.payload.session_boundary !== true
        ) {
          inFlight = Promise.withResolvers<void>()
          await inFlight.promise
        }
        const event = normalizeHookPayload(server._getStateForTests(), 'omp', body, 'production')
        if (!event) {
          throw new Error('Expected a normalized OMP consumer event')
        }
        server.ingestRemote(event, null)
        accepted.push(body)
        return { ok: true }
      })
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'first A turn' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        root.ref.status = 'idle'
        root.session.isStreaming = false
        await fixture.harness.callHook('agent_end', {}, root.context)
        await vi.advanceTimersByTimeAsync(0)
        if (!inFlight) {
          throw new Error('Expected the original completion in flight')
        }

        root.ref.status = 'running'
        root.session.isStreaming = true
        await fixture.harness.callHook('agent_start', {}, root.context)
        await fixture.harness.callHook('session_switch', { reason: 'resume' }, root.context)
        // A prompt can begin before its agent_start, then the registration is replaced.
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'unsent A turn' },
          root.context
        )
        await fixture.harness.callHook('session_shutdown', { reason: 'reload' }, root.context)
        root.replaceSession('queued-B')
        root.ref.status = 'running'
        root.session.isStreaming = true
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'latest B turn' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        inFlight.resolve()
        await vi.advanceTimersByTimeAsync(1_000)

        const payloads = accepted.map(({ payload }) => payload)
        const completions = payloads.filter(
          (payload) => payload.hook_event_name === 'agent_end' && payload.session_boundary !== true
        )
        expect(completions).toEqual([
          expect.objectContaining({ session_id: 'queued-A', hook_event_name: 'agent_end' })
        ])
        const closeIndex = payloads.findIndex(
          (payload) => payload.session_id === 'queued-A' && payload.session_boundary === true
        )
        const currentIndex = payloads.findIndex((payload) => payload.session_id === 'queued-B')
        expect(closeIndex).toBeGreaterThanOrEqual(0)
        expect(currentIndex).toBeGreaterThan(closeIndex)
        expect(
          payloads.slice(currentIndex).every((payload) => payload.session_id === 'queued-B')
        ).toBe(true)
        expect(server.getStatusSnapshot().find((row) => row.paneKey === PANE)).toMatchObject({
          state: 'working',
          prompt: 'latest B turn',
          providerSession: { id: 'queued-B', transcriptPath: '/sessions/queued-B.jsonl' }
        })
      } finally {
        inFlight?.resolve()
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        server.stop()
      }
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
