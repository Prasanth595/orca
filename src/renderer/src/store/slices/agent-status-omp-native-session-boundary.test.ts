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

type HookServer = {
  _getStateForTests: () => HookListenerState
  ingestRemote: (event: AgentHookEventPayload, connectionId: null) => void
  getStatusSnapshot: () => AgentStatusIpcPayload[]
  stop: () => void
}
type HookBody = { paneKey: string; payload: Record<string, unknown> }
type NativeRoot = {
  ref: { status: string }
  session: { isStreaming: boolean }
  context: object
  file: string
  replaceSession: (id: string) => void
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
  ) => {
    harness: {
      fetchMock: Mock<(url: unknown, request?: RequestInit) => Promise<{ ok: boolean }>>
      callHook: (name: string, event?: unknown, context?: object) => Promise<void>
    }
  }
}

const PANE = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const OLD_PROMPT = 'Native OMP old root turn'
const NEW_ID = 'unprompted-native-root'

function isNewIdentitySnapshot(body: HookBody): boolean {
  return body.payload.session_id === NEW_ID && body.payload.hook_event_name === 'subagents_update'
}

describe('OMP native scope clocks through the renderer store', () => {
  useAgentCompletionCoordinatorLifecycle()
  afterEach(() => vi.clearAllTimers())

  describe.each(['omp', 'pi'] as const)('%s-routed OMP', (kind) => {
    it.each(['unprompted', 'opening before first identity ACK'] as const)(
      'keeps canonical turn-clock truth after an old done scope: %s',
      async (mode) => {
        const { AgentHookServer } = await vi.importActual<{
          AgentHookServer: new () => HookServer
        }>('../../../../main/agent-hooks/server')
        const native = await vi.importActual<NativeFixtureModule>(
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
        const root = native.nativeRoot('old-native-root', true)
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
        const hostRows: AgentStatusIpcPayload[] = []
        let loseIdentityAck = mode !== 'unprompted'
        fixture.harness.fetchMock.mockImplementation(async (_url, request) => {
          const body: HookBody = JSON.parse(String(request?.body))
          const event = normalizeHookPayload(server._getStateForTests(), 'omp', body, 'production')
          if (!event) {
            throw new Error('Expected a native OMP hook consumer event')
          }
          server.ingestRemote(event, null)
          const row = server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
          if (!row) {
            throw new Error('Expected a real HookServer row')
          }
          const payload = normalizeAgentStatusEvent(row)
          if (!payload) {
            throw new Error('Expected an IPC-normalized renderer payload')
          }
          accepted.push(body)
          hostRows.push(row)
          // Use the production IPC normalization and public RootStore write. In
          // particular, an absent host turn clock remains absent, not stamped here.
          store.getState().setAgentStatus(
            PANE,
            { ...payload, ...(row.observation ? { observation: row.observation } : {}) },
            'OMP',
            {
              updatedAt: row.receivedAt,
              stateStartedAt: row.stateStartedAt,
              ...(Number.isFinite(row.turnStartedAt) ? { turnStartedAt: row.turnStartedAt } : {})
            },
            { tabId: 'tab-1', worktreeId: 'wt-1' },
            normalizeAgentStatusMetadata(row)
          )
          coordinator.observeHookStatus(row)
          if (loseIdentityAck && isNewIdentitySnapshot(body)) {
            loseIdentityAck = false
            throw new Error('native identity accepted but its ACK was lost')
          }
          return { ok: true }
        })
        try {
          await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
          await fixture.harness.callHook('before_agent_start', { prompt: OLD_PROMPT }, root.context)
          await fixture.harness.callHook('agent_start', {}, root.context)
          await vi.advanceTimersByTimeAsync(1_000)
          await fixture.harness.callHook(
            'message_end',
            {
              message: { role: 'assistant', content: [{ type: 'text', text: 'Old root finished' }] }
            },
            root.context
          )
          root.ref.status = 'idle'
          root.session.isStreaming = false
          await fixture.harness.callHook('agent_end', {}, root.context)
          await vi.advanceTimersByTimeAsync(2_000)
          const oldClock = hostRows.at(-1)?.turnStartedAt
          expect(oldClock).toBeDefined()
          expect(store.getState().agentStatusByPaneKey[PANE].turnStartedAt).toBe(oldClock)
          expect(dispatchCompletion).toHaveBeenCalledTimes(1)
          const previousSessionFile = root.file
          root.replaceSession(NEW_ID)
          // The native SDK registers Main as running before any new prompt.
          root.ref.status = 'running'
          const scopeChangedAt = Date.now()
          await fixture.harness.callHook(
            'session_switch',
            { reason: 'new', previousSessionFile },
            root.context
          )
          let newClock: number | undefined
          if (mode !== 'unprompted') {
            root.session.isStreaming = true
            await fixture.harness.callHook(
              'before_agent_start',
              { prompt: 'Genuine new root turn' },
              root.context
            )
            await fixture.harness.callHook('agent_start', {}, root.context)
            await vi.advanceTimersByTimeAsync(0)
            newClock = hostRows.at(-1)?.turnStartedAt
            expect(newClock).toBe(scopeChangedAt)
            expect(newClock).not.toBe(oldClock)
            expect(accepted.filter(isNewIdentitySnapshot)).toEqual([])
            await vi.advanceTimersByTimeAsync(100)
            root.ref.status = 'idle'
            root.session.isStreaming = false
            await fixture.harness.callHook('agent_end', {}, root.context)
          }
          await vi.advanceTimersByTimeAsync(3_000)

          const canonical = hostRows.at(-1)
          expect(canonical).toMatchObject({
            state: 'done',
            prompt: mode === 'unprompted' ? '' : 'Genuine new root turn',
            providerSession: { id: NEW_ID, transcriptPath: root.file }
          })
          // This assertion locates the bug after host admission, not in native binding.
          expect(canonical?.turnStartedAt).toBe(newClock)
          expect(canonical?.turnCompletedAt).toBeUndefined()
          expect(canonical?.subagents ?? []).toEqual([])
          const entry = store.getState().agentStatusByPaneKey[PANE]
          expect(entry.providerSession).toEqual(canonical?.providerSession)
          expect(entry.turnStartedAt).toBe(newClock)
          expect(entry.stateStartedAt).toBe(canonical?.stateStartedAt)
          expect(entry.mainAgent).toEqual(canonical?.mainAgent)
          expect(entry).not.toHaveProperty('turnCompletedAt')
          expect(entry.toolName).toBeUndefined()
          expect(entry.toolInput).toBeUndefined()
          expect(entry.lastAssistantMessage).toBeUndefined()
          // History is pane-scoped: retain the old real completion for unread/history consumers.
          expect(
            entry.stateHistory.some(
              (history) => history.state === 'done' && history.prompt === OLD_PROMPT
            )
          ).toBe(true)
          expect(dispatchCompletion).toHaveBeenCalledTimes(mode === 'unprompted' ? 1 : 2)
          if (mode !== 'unprompted') {
            const snapshots = accepted.filter(isNewIdentitySnapshot)
            expect(snapshots).toHaveLength(2)
            for (const snapshot of snapshots) {
              expect(snapshot.payload.omp_status).toMatchObject({
                state: 'done',
                session_boundary: true
              })
            }
          }
        } finally {
          await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
          await vi.advanceTimersByTimeAsync(0)
          coordinator.dispose()
          server.stop()
        }
      }
    )
  })

  it.each([
    {
      agent: 'omp' as const,
      incoming: { key: 'session_id' as const, id: 'new', transcriptPath: '/sessions/new.jsonl' },
      oldFactsExpected: false
    },
    {
      agent: 'omp' as const,
      incoming: { key: 'session_id' as const, id: 'old' },
      oldFactsExpected: true
    },
    {
      agent: 'pi' as const,
      incoming: { key: 'session_id' as const, id: 'new', transcriptPath: '/sessions/new.jsonl' },
      oldFactsExpected: true
    },
    {
      agent: 'prime-agent' as const,
      incoming: { key: 'session_id' as const, id: 'new', transcriptPath: '/sessions/new.jsonl' },
      oldFactsExpected: true
    }
  ])(
    'keeps unknown facts scope-safe without changing $agent blind-writer semantics ($oldFactsExpected)',
    ({ agent, incoming, oldFactsExpected }) => {
      const store = createTestStore()
      const oldMainAgent = { state: 'done' as const, stateStartedAt: 1_500 }
      store
        .getState()
        .setAgentStatus(
          PANE,
          { state: 'done', prompt: OLD_PROMPT, agentType: agent, mainAgent: oldMainAgent },
          undefined,
          { updatedAt: 2_000, stateStartedAt: 1_500, turnStartedAt: 1_000 },
          undefined,
          {
            providerSession: { key: 'session_id', id: 'old', transcriptPath: '/sessions/old.jsonl' }
          }
        )
      store.getState().setAgentStatus(
        PANE,
        {
          state: 'done',
          prompt: '',
          agentType: agent,
          sessionBoundary: true,
          observation: {
            origin: 'osc',
            authorityId: 'renderer',
            incarnation: 0,
            revision: 2,
            observedAt: 3_000,
            kind: 'snapshot'
          }
        },
        undefined,
        { updatedAt: 3_000, stateStartedAt: 3_000 },
        undefined,
        { providerSession: incoming }
      )
      const entry = store.getState().agentStatusByPaneKey[PANE]
      expect(entry.turnStartedAt).toBe(oldFactsExpected ? 1_000 : undefined)
      expect(entry.mainAgent).toEqual(oldFactsExpected ? oldMainAgent : undefined)
      expect(entry.providerSession).toEqual(incoming)
      expect(entry).not.toHaveProperty('turnCompletedAt')
    }
  )
})
