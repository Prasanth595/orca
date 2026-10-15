import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { normalizeHookPayload } from '../../../../shared/agent-hook-listener'
import type { AgentHookEventPayload } from '../../../../shared/agent-hook-listener/listener-event'
import type { HookListenerState } from '../../../../shared/agent-hook-listener/listener-state'
import type { AgentStatusIpcPayload } from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { createAgentCompletionCoordinator } from '../../components/terminal-pane/agent-completion-coordinator'
import { useAgentCompletionCoordinatorLifecycle } from '../../components/terminal-pane/agent-completion-coordinator-test-harness'
import {
  normalizeAgentStatusEvent,
  normalizeAgentStatusMetadata
} from '../../hooks/ipc-events/normalize-agent-status-event'
import { createTestStore } from './store-test-helpers'

vi.mock('../../../../main/telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../../../main/telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

// Runtime imports keep the real host chain outside the renderer's composite TS project.
type HookServer = {
  _getStateForTests: () => HookListenerState
  ingestRemote: (event: AgentHookEventPayload, connectionId: null) => void
  getStatusSnapshot: () => AgentStatusIpcPayload[]
  stop: () => void
}
type Root = {
  ref: { status: string }
  session: { isStreaming: boolean }
  context: object
  file: string
  replaceSession: (id: string) => void
}
type NativeModule = {
  NATIVE_TIME: number
  nativeRoot: (id: string, streaming: boolean) => Root
  createNativeFixture: (
    root: Root,
    children: object[],
    options: {
      runtime: { kind: 'pi'; argv: string[] }
      env: Record<string, string | undefined>
    }
  ) => {
    harness: {
      fetchMock: Mock<(url: unknown, request?: RequestInit) => Promise<{ ok: boolean }>>
      callHook: (name: string, event?: unknown, context?: object) => Promise<void>
    }
  }
}
const PANE = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')

describe('OMP native session clocks through host IPC and RootStore', () => {
  useAgentCompletionCoordinatorLifecycle()
  afterEach(() => vi.clearAllTimers())

  it.each(['unprompted', 'real turn with lost ACKs'] as const)(
    'does not borrow the previous session clock: %s',
    async (mode) => {
      const { AgentHookServer } = await vi.importActual<{ AgentHookServer: new () => HookServer }>(
        '../../../../main/agent-hooks/server'
      )
      const native = await vi.importActual<NativeModule>(
        '../../../../main/pi/agent-status-extension-omp-registry-fixture'
      )
      vi.setSystemTime(native.NATIVE_TIME)
      const server = new AgentHookServer()
      const store = createTestStore()
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
      const root = native.nativeRoot('old', true)
      const { harness } = native.createNativeFixture(root, [], {
        runtime: { kind: 'pi', argv: ['bun', '/opt/omp/bin/omp'] },
        env: {
          ORCA_AGENT_HOOK_ENV: 'production',
          ORCA_PANE_KEY: PANE,
          ORCA_WORKTREE_ID: 'wt-1',
          ORCA_AGENT_LAUNCH_TOKEN: undefined
        }
      })
      const accepted: Record<string, unknown>[] = []
      const lost = new Set<unknown>()
      const canonical = () => server.getStatusSnapshot().find((row) => row.paneKey === PANE)
      harness.fetchMock.mockImplementation(async (_url, request) => {
        const body: { paneKey: string; payload: Record<string, unknown> } = JSON.parse(
          String(request?.body)
        )
        const event = normalizeHookPayload(server._getStateForTests(), 'omp', body, 'production')
        if (!event) {
          throw new Error('Missing native hook event')
        }
        server.ingestRemote(event, null)
        const row = canonical()
        if (!row) {
          throw new Error('Missing admitted host row')
        }
        const payload = normalizeAgentStatusEvent(row)
        if (!payload) {
          throw new Error('Missing IPC status payload')
        }
        store.getState().setAgentStatus(
          PANE,
          payload,
          'OMP',
          {
            updatedAt: row.receivedAt,
            stateStartedAt: row.stateStartedAt,
            ...(row.turnStartedAt === undefined ? {} : { turnStartedAt: row.turnStartedAt })
          },
          { tabId: 'tab-1', worktreeId: 'wt-1' },
          normalizeAgentStatusMetadata(row)
        )
        coordinator.observeHookStatus(row)
        accepted.push(body.payload)
        const eventName = body.payload.hook_event_name
        if (
          mode !== 'unprompted' &&
          body.payload.session_id === 'new' &&
          ['agent_end', 'subagents_update'].includes(String(eventName)) &&
          !lost.has(eventName)
        ) {
          lost.add(eventName)
          throw new Error('Accepted native update lost its ACK')
        }
        return { ok: true }
      })
      const hook = (name: string, event: unknown = {}) =>
        harness.callHook(name, event, root.context)
      const finish = async () => {
        await hook('message_end', {
          message: { role: 'assistant', content: [{ type: 'text', text: 'Native completion' }] }
        })
        root.ref.status = 'idle'
        root.session.isStreaming = false
        await hook('agent_end')
      }
      try {
        await hook('session_start', { reason: 'startup' })
        await hook('before_agent_start', { prompt: 'old turn' })
        await hook('agent_start')
        await vi.advanceTimersByTimeAsync(1000)
        await finish()
        await vi.advanceTimersByTimeAsync(2_000)
        const oldClock = canonical()?.turnStartedAt
        expect(oldClock).toBeDefined()
        expect(dispatchCompletion).toHaveBeenCalledTimes(1)

        root.replaceSession('new')
        root.ref.status = 'running'
        await hook('session_switch', { reason: 'new' })
        let newClock: number | undefined
        if (mode !== 'unprompted') {
          root.session.isStreaming = true
          await hook('before_agent_start', { prompt: 'new turn' })
          await hook('agent_start')
          await vi.advanceTimersByTimeAsync(0)
          newClock = canonical()?.turnStartedAt
          expect(newClock).toBe(Date.now())
          expect(newClock).not.toBe(oldClock)
          expect(
            accepted.some(
              (body) => body.session_id === 'new' && body.hook_event_name === 'subagents_update'
            )
          ).toBe(false)
          await vi.advanceTimersByTimeAsync(100)
          await finish()
        }
        await vi.advanceTimersByTimeAsync(3000)
        const host = canonical()
        const shown = store.getState().agentStatusByPaneKey[PANE]
        expect(host).toMatchObject({
          state: 'done',
          prompt: mode === 'unprompted' ? '' : 'new turn',
          providerSession: { id: 'new', transcriptPath: root.file }
        })
        expect(host?.turnStartedAt).toBe(newClock)
        expect(shown.turnStartedAt).toBe(newClock)
        expect(shown.mainAgent).toEqual(host?.mainAgent)
        expect(shown.stateStartedAt).toBe(host?.stateStartedAt)
        expect(host?.turnCompletedAt).toBeUndefined()
        expect(
          shown.stateHistory.some((row) => row.state === 'done' && row.prompt === 'old turn')
        ).toBe(true)
        expect(dispatchCompletion).toHaveBeenCalledTimes(mode === 'unprompted' ? 1 : 2)
        if (mode !== 'unprompted') {
          expect(
            accepted.filter(
              (body) => body.session_id === 'new' && body.hook_event_name === 'agent_end'
            )
          ).toHaveLength(2)
          expect(
            accepted.filter(
              (body) => body.session_id === 'new' && body.hook_event_name === 'subagents_update'
            )
          ).toHaveLength(2)
        }
      } finally {
        await hook('session_shutdown', { reason: 'quit' })
        await vi.advanceTimersByTimeAsync(0)
        coordinator.dispose()
        server.stop()
      }
    }
  )

  it.each(['omp', 'pi', 'prime-agent'] as const)(
    'preserves blind-writer compatibility for %s',
    (agentType) => {
      const store = createTestStore()
      const session = { key: 'session_id' as const, id: 'old', transcriptPath: '/old.jsonl' }
      store.getState().setAgentStatus(
        PANE,
        {
          state: 'done',
          prompt: '',
          agentType,
          mainAgent: { state: 'done', stateStartedAt: 1500 }
        },
        undefined,
        { updatedAt: 2000, turnStartedAt: 1000 },
        undefined,
        { providerSession: session }
      )
      store
        .getState()
        .setAgentStatus(
          PANE,
          { state: 'done', prompt: '', agentType },
          undefined,
          { updatedAt: 3000 },
          undefined,
          {
            providerSession:
              agentType === 'omp'
                ? { key: 'session_id', id: 'old' }
                : { key: 'session_id', id: 'new', transcriptPath: '/new.jsonl' }
          }
        )
      expect(store.getState().agentStatusByPaneKey[PANE].turnStartedAt).toBe(1000)
    }
  )
})
