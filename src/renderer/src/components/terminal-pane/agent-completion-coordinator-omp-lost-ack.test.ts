import { describe, expect, it, vi, type Mock } from 'vitest'

import { normalizeHookPayload } from '../../../../shared/agent-hook-listener'
import type { AgentHookEventPayload } from '../../../../shared/agent-hook-listener/listener-event'
import type { HookListenerState } from '../../../../shared/agent-hook-listener/listener-state'
import type { AgentStatusIpcPayload } from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { createAgentCompletionCoordinator } from './agent-completion-coordinator'
import { useAgentCompletionCoordinatorLifecycle } from './agent-completion-coordinator-test-harness'

vi.mock('../../../../main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../../main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

// Follow the renderer host-chain convention: load real main modules at runtime
// while keeping the renderer's composite TypeScript project inside its boundary.
type HookServer = {
  _getStateForTests: () => HookListenerState
  ingestRemote: (event: AgentHookEventPayload, connectionId: null) => void
  getStatusSnapshot: () => AgentStatusIpcPayload[]
  stop: () => void
}
type HookServerModule = { AgentHookServer: new () => HookServer }
type HookBody = { paneKey: string; payload: Record<string, unknown> }
type NativeRoot = {
  ref: { status: string }
  session: { isStreaming: boolean }
  context: object
  file: string
}
type NativeFixture = {
  harness: {
    fetchMock: Mock<(url: unknown, request?: RequestInit) => Promise<{ ok: boolean }>>
    callHook: (name: string, event?: unknown, context?: object) => Promise<void>
  }
}
type NativeFixtureModule = {
  NATIVE_TIME: number
  nativeRoot: (id: string, isStreaming: boolean) => NativeRoot
  createNativeFixture: (
    root: NativeRoot,
    children: object[],
    options: {
      runtime: { kind: 'omp' | 'pi'; argv: string[] }
      env: Record<string, string | undefined>
    }
  ) => NativeFixture
}

const PANE = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')

describe('OMP acknowledged retry completion notifications', () => {
  useAgentCompletionCoordinatorLifecycle()

  it.each(['omp', 'pi'] as const)(
    'deduplicates %s lost-ACK delivery through the real generated producer and hook consumer',
    async (kind) => {
      const { AgentHookServer } = await vi.importActual<HookServerModule>(
        '../../../../main/agent-hooks/server'
      )
      const native = await vi.importActual<NativeFixtureModule>(
        '../../../../main/pi/agent-status-extension-omp-registry-fixture'
      )
      vi.setSystemTime(native.NATIVE_TIME)
      const server = new AgentHookServer()
      const dispatchCompletion = vi.fn()
      const coordinator = createAgentCompletionCoordinator({
        paneKey: PANE,
        statusLane: 'hook',
        getPtyId: () => null,
        getSettings: () => null,
        inspectProcess: vi.fn(),
        dispatchCompletion,
        shouldPollProcessCadence: () => false,
        isLive: () => true
      })
      const root = native.nativeRoot('ack-root', true)
      const fixture = native.createNativeFixture(root, [], {
        runtime: { kind, argv: ['bun', '/opt/omp/bin/omp'] },
        env: {
          ORCA_AGENT_HOOK_ENV: 'production',
          ORCA_PANE_KEY: PANE,
          ORCA_WORKTREE_ID: 'wt-1',
          ORCA_AGENT_LAUNCH_TOKEN: undefined
        }
      })
      const accepted: HookBody[] = []
      const rows: AgentStatusIpcPayload[] = []
      let loseCompletionAck = true
      fixture.harness.fetchMock.mockImplementation(async (_url, request) => {
        const body: HookBody = JSON.parse(String(request?.body))
        const event = normalizeHookPayload(server._getStateForTests(), 'omp', body, 'production')
        if (!event) {
          throw new Error('Expected a normalized OMP hook')
        }
        server.ingestRemote(event, null)
        const row = server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
        if (!row) {
          throw new Error('Expected an admitted OMP consumer row')
        }
        accepted.push(body)
        rows.push(row)
        coordinator.observeHookStatus(row)
        if (loseCompletionAck && body.payload.hook_event_name === 'agent_end') {
          loseCompletionAck = false
          throw new Error('receiver accepted the body but its acknowledgment was lost')
        }
        return { ok: true }
      })
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'finish once' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        await fixture.harness.callHook(
          'message_end',
          { message: { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] } },
          root.context
        )
        await vi.advanceTimersByTimeAsync(0)
        root.ref.status = 'idle'
        root.session.isStreaming = false
        await fixture.harness.callHook('agent_end', {}, root.context)
        await vi.advanceTimersByTimeAsync(0)
        const firstDoneAt = rows.at(-1)?.stateStartedAt
        expect(rows.at(-1)?.state).toBe('done')
        await vi.advanceTimersByTimeAsync(10_000)

        // A lost ACK permits duplicate wire deliveries, not duplicate completion banners.
        const completions = accepted.filter(
          ({ payload }) => payload.hook_event_name === 'agent_end'
        )
        expect(completions).toHaveLength(2)
        expect(
          completions.every(
            ({ payload }) => payload.session_id === 'ack-root' && payload.session_file === root.file
          )
        ).toBe(true)
        expect(rows.at(-1)).toMatchObject({
          state: 'done',
          stateStartedAt: firstDoneAt,
          mainAgent: { state: 'done', stateStartedAt: firstDoneAt },
          lastAssistantMessage: 'final answer',
          providerSession: { id: 'ack-root', transcriptPath: root.file }
        })
        expect(dispatchCompletion).toHaveBeenCalledTimes(1)
        expect(dispatchCompletion).toHaveBeenCalledWith(
          'omp',
          expect.objectContaining({
            source: 'hook',
            agentStatus: expect.objectContaining({
              state: 'done',
              stateStartedAt: firstDoneAt,
              lastAssistantMessage: 'final answer'
            })
          })
        )
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        coordinator.dispose()
        server.stop()
      }
      expect(vi.getTimerCount()).toBe(0)
    }
  )
})
