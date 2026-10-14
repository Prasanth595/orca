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

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const CONSUMER_ENV = {
  ORCA_AGENT_HOOK_ENV: 'production',
  ORCA_PANE_KEY: PANE,
  ORCA_WORKTREE_ID: 'wt-1',
  ORCA_AGENT_LAUNCH_TOKEN: undefined
}

function consumer(server: AgentHookServer) {
  const accepted: Body[] = []
  const rows: AgentStatusIpcPayload[] = []
  return {
    accepted,
    rows,
    admit(body: Body): void {
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
    }
  }
}

describe('native OMP outage recovery delivery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe.each(['omp', 'pi'] as const)('%s-routed OMP', (kind) => {
    it.each([
      'acknowledged',
      'failed',
      'scheduled retry',
      'failed with current completion'
    ] as const)(
      'recovers the latest native scope promptly after churn with an old close %s',
      async (delivery) => {
        const server = new AgentHookServer()
        const receiver = consumer(server)
        const root = nativeRoot('scope-0', true)
        const fixture = createNativeFixture(root, [nativeChild('ScopeChild', root.file)], {
          runtime: { kind, argv: ['bun', '/opt/omp/bin/omp'] },
          env: CONSUMER_ENV
        })
        let online = true
        let heldClose: PromiseWithResolvers<void> | undefined
        fixture.harness.fetchMock.mockImplementation(async (_url, request) => {
          const body: Body = JSON.parse(String(request?.body))
          if (!online) {
            if (
              delivery !== 'scheduled retry' &&
              !heldClose &&
              body.payload.hook_event_name === 'agent_end'
            ) {
              heldClose = Promise.withResolvers<void>()
              request.signal.addEventListener(
                'abort',
                () => heldClose?.reject(new Error('aborted')),
                {
                  once: true
                }
              )
              await heldClose.promise
              receiver.admit(body)
              return { ok: true }
            }
            throw new Error('receiver offline')
          }
          // A recovering receiver still has real per-request work; history must not delay its row.
          await new Promise<void>((resolve) => setTimeout(resolve, 40))
          receiver.admit(body)
          return { ok: true }
        })
        try {
          await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
          await fixture.harness.callHook(
            'before_agent_start',
            { prompt: 'old scope' },
            root.context
          )
          await fixture.harness.callHook('agent_start', {}, root.context)
          await vi.advanceTimersByTimeAsync(1_000)
          await fixture.harness.callHook(
            'tool_execution_start',
            { toolName: 'bash', args: { command: 'printf old-scope' } },
            root.context
          )
          await fixture.harness.callHook(
            'message_end',
            {
              message: { role: 'assistant', content: [{ type: 'text', text: 'old scope answer' }] }
            },
            root.context
          )
          await vi.advanceTimersByTimeAsync(300)
          online = false

          for (let scope = 1; scope <= 80; scope++) {
            root.replaceSession(`scope-${scope}`)
            root.ref.status = 'running'
            root.session.isStreaming = true
            fixture.refs.set(
              'ScopeChild',
              nativeChild('ScopeChild', root.file, Date.now(), `scope-${scope}-child`)
            )
            await fixture.harness.callHook('session_switch', { reason: 'new' }, root.context)
            await fixture.harness.callHook(
              'before_agent_start',
              { prompt: `scope-${scope} prompt` },
              root.context
            )
            await fixture.harness.callHook('agent_start', {}, root.context)
            await vi.advanceTimersByTimeAsync(1)
          }
          if (delivery !== 'scheduled retry' && !heldClose) {
            throw new Error('Expected the original close to remain in flight')
          }
          const currentCompleted = delivery === 'failed with current completion'
          if (currentCompleted) {
            root.ref.status = 'idle'
            root.session.isStreaming = false
            const child = fixture.refs.get('ScopeChild')
            if (!child) {
              throw new Error('Expected the current native child')
            }
            fixture.setStatus(child, 'idle')
            await fixture.harness.callHook('agent_end', {}, root.context)
            await vi.advanceTimersByTimeAsync(300)
            await fixture.harness.callHook(
              'model_select',
              { model: { provider: 'orca-fixture', id: 'current-model' } },
              root.context
            )
          }
          const beforeRecovery = receiver.accepted.length
          online = true
          const recoveredAt = Date.now()
          if (delivery === 'acknowledged') {
            heldClose?.resolve()
          } else if (heldClose) {
            heldClose.reject(new Error('lost old connection'))
          }
          await vi.advanceTimersByTimeAsync(2_000)

          const row = receiver.rows.at(-1)
          expect(row).toMatchObject({
            state: currentCompleted ? 'done' : 'working',
            prompt: 'scope-80 prompt',
            mainAgent: { state: currentCompleted ? 'done' : 'working' },
            providerSession: { id: 'scope-80', transcriptPath: '/sessions/scope-80.jsonl' }
          })
          expect(row?.subagents ?? []).toEqual(
            currentCompleted
              ? []
              : [expect.objectContaining({ id: 'ScopeChild', state: 'working' })]
          )
          expect(row?.toolName).toBeUndefined()
          expect(row?.toolInput).toBeUndefined()
          expect(row?.lastAssistantMessage).toBeUndefined()
          if (currentCompleted) {
            expect(row?.model).toBe('orca-fixture/current-model')
          }
          expect(
            receiver.rows
              .filter((status) => status.providerSession?.id === 'scope-80')
              .every(
                (status) =>
                  status.prompt !== 'old scope' &&
                  status.toolInput !== 'printf old-scope' &&
                  status.lastAssistantMessage !== 'old scope answer'
              )
          ).toBe(true)
          expect(row?.receivedAt).toBeLessThanOrEqual(recoveredAt + 2_000)
          if (!currentCompleted) {
            expect(row?.subagents?.[0]?.startedAt).toBeGreaterThan(NATIVE_TIME)
          }
          const recovered = receiver.accepted.slice(beforeRecovery).map(({ payload }) => payload)
          const closeIndex = recovered.findIndex(
            (payload) => payload.session_id === 'scope-79' && payload.session_boundary === true
          )
          const currentIndex = recovered.findIndex((payload) => payload.session_id === 'scope-80')
          expect(closeIndex).toBeGreaterThanOrEqual(0)
          expect(currentIndex).toBeGreaterThan(closeIndex)
          expect(
            recovered.slice(currentIndex).every((payload) => payload.session_id === 'scope-80')
          ).toBe(true)
          const completedRows = receiver.rows.filter(
            (status) => status.state === 'done' && !status.sessionBoundary
          )
          expect(
            completedRows.every(
              (status) => currentCompleted && status.providerSession?.id === 'scope-80'
            )
          ).toBe(true)
          if (currentCompleted) {
            const completionIndex = recovered.findIndex(
              (payload) =>
                payload.hook_event_name === 'agent_end' && payload.session_id === 'scope-80'
            )
            expect(completionIndex).toBeGreaterThan(closeIndex)
            expect(recovered[completionIndex + 1]).toMatchObject({
              hook_event_name: 'subagents_update',
              session_id: 'scope-80',
              omp_status: { state: 'done' },
              subagents: []
            })
          }
        } finally {
          heldClose?.resolve()
          online = true
          await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
          await vi.advanceTimersByTimeAsync(100)
          server.stop()
        }
        const stoppedPosts = fixture.harness.fetchMock.mock.calls.length
        await vi.advanceTimersByTimeAsync(60_000)
        expect(fixture.harness.fetchMock).toHaveBeenCalledTimes(stoppedPosts)
        expect(vi.getTimerCount()).toBe(0)
      }
    )

    it.each(['ACK', 'failure'] as const)(
      'preserves current root facts when the active snapshot settles with %s',
      async (result) => {
        const server = new AgentHookServer()
        const receiver = consumer(server)
        const root = nativeRoot('retired-snapshot-root', true)
        const fixture = createNativeFixture(root, [], {
          runtime: { kind, argv: ['bun', '/opt/omp/bin/omp'] },
          env: CONSUMER_ENV
        })
        let snapshot: PromiseWithResolvers<void> | undefined
        fixture.harness.fetchMock.mockImplementation(async (_url, request) => {
          const body: Body = JSON.parse(String(request?.body))
          const nativeState = body.payload.omp_status
          if (
            !snapshot &&
            body.payload.session_id === 'active-snapshot-root' &&
            nativeState &&
            typeof nativeState === 'object' &&
            'state' in nativeState &&
            nativeState.state === 'done'
          ) {
            snapshot = Promise.withResolvers<void>()
            await snapshot.promise
          }
          receiver.admit(body)
          return { ok: true }
        })
        try {
          await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
          await fixture.harness.callHook(
            'before_agent_start',
            { prompt: 'retired prompt' },
            root.context
          )
          await fixture.harness.callHook('agent_start', {}, root.context)
          await vi.advanceTimersByTimeAsync(1_000)
          root.replaceSession('active-snapshot-root')
          root.ref.status = 'running'
          root.session.isStreaming = true
          await fixture.harness.callHook('session_switch', { reason: 'new' }, root.context)
          await fixture.harness.callHook(
            'before_agent_start',
            { prompt: 'current full facts' },
            root.context
          )
          await fixture.harness.callHook('agent_start', {}, root.context)
          await vi.advanceTimersByTimeAsync(0)
          root.ref.status = 'idle'
          root.session.isStreaming = false
          await fixture.harness.callHook('agent_end', {}, root.context)
          await vi.advanceTimersByTimeAsync(0)
          if (!snapshot) {
            throw new Error('Expected the current authoritative snapshot in flight')
          }
          if (result === 'ACK') {
            snapshot.resolve()
          } else {
            snapshot.reject(new Error('snapshot connection failed before acceptance'))
          }
          await vi.advanceTimersByTimeAsync(3_000)

          expect(receiver.rows.at(-1)).toMatchObject({
            state: 'done',
            prompt: 'current full facts',
            providerSession: { id: 'active-snapshot-root', transcriptPath: root.file }
          })
          const current = receiver.accepted.filter(
            ({ payload }) => payload.session_id === 'active-snapshot-root'
          )
          expect(
            current.filter(({ payload }) => payload.hook_event_name === 'agent_end')
          ).toHaveLength(1)
          expect(
            current.filter(({ payload }) => payload.hook_event_name === 'subagents_update')
          ).toHaveLength(1)
        } finally {
          snapshot?.resolve()
          await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
          await vi.advanceTimersByTimeAsync(0)
          server.stop()
        }
        expect(vi.getTimerCount()).toBe(0)
      }
    )
  })
})
