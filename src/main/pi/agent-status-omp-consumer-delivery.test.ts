import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { AgentHookServer } from '../agent-hooks/server'
import { buildBody, PANE } from '../agent-hooks/server.test-fixtures'
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

let server: AgentHookServer
let rows: AgentStatusIpcPayload[]

function receive(payload: Record<string, unknown>): { ok: true } {
  const event = normalizeHookPayload(
    server._getStateForTests(),
    'omp',
    buildBody(payload),
    'production'
  )
  if (!event) {
    throw new Error('Expected native OMP evidence to normalize')
  }
  server.ingestRemote(event, null)
  const row = server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
  if (!row) {
    throw new Error('Expected an admitted native OMP row')
  }
  rows.push(row)
  return { ok: true }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NATIVE_TIME)
  server = new AgentHookServer()
  rows = []
})

afterEach(() => {
  server.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('native OMP delivery consumer', () => {
  it('keeps root T1 through aggregate T2, snapshot failure and model coalescing', async () => {
    const root = nativeRoot('root-clock', true)
    const child = nativeChild('ClockChild', root.file)
    let snapshot: PromiseWithResolvers<void> | undefined
    const fixture = createNativeFixture(root, [child], {
      env: CONSUMER_ENV,
      delivery: async (payload) => {
        if (
          !snapshot &&
          payload.hook_event_name === 'subagents_update' &&
          payload.subagents?.[0]?.agentType === 'updated-role'
        ) {
          snapshot = Promise.withResolvers<void>()
          await snapshot.promise
        }
        return receive(payload)
      }
    })
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook(
        'before_agent_start',
        { prompt: 'Finish with a child' },
        root.context
      )
      await fixture.harness.callHook('agent_start', {}, root.context)
      await fixture.harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: [{ type: 'text', text: 'Root final answer' }] } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      root.ref.status = 'idle'
      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const held = rows.at(-1)!
      expect(held).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })
      const rootDoneAt = held.mainAgent?.stateStartedAt
      if (typeof rootDoneAt !== 'number') {
        throw new Error('Expected the root completion clock')
      }
      expect(rootDoneAt).toBeGreaterThan(NATIVE_TIME)
      expect(held.turnCompletedAt).toBeUndefined()

      await vi.advanceTimersByTimeAsync(4_000)
      child.history!.agent = 'updated-role'
      fixture.notify('metadata_changed', child)
      await vi.advanceTimersByTimeAsync(300)
      if (!snapshot) {
        throw new Error('Expected the active native snapshot in flight')
      }
      fixture.setStatus(child, 'idle')
      await vi.advanceTimersByTimeAsync(300)
      await fixture.harness.callHook(
        'model_select',
        { model: { provider: 'orca-fixture', id: 'current-model' } },
        root.context
      )
      snapshot.reject(new Error('snapshot connection failed before acceptance'))
      await vi.advanceTimersByTimeAsync(1_000)

      const completed = rows.at(-1)!
      expect(completed).toMatchObject({
        state: 'done',
        prompt: 'Finish with a child',
        lastAssistantMessage: 'Root final answer',
        model: 'orca-fixture/current-model',
        mainAgent: { state: 'done', stateStartedAt: rootDoneAt },
        providerSession: { id: 'root-clock', transcriptPath: root.file }
      })
      expect(completed.stateStartedAt).toBeGreaterThan(rootDoneAt)
      expect(completed.subagents ?? []).toEqual([])
      const posts = fixture.accepted.map(({ payload }) => payload)
      const completionIndex = posts.findIndex((payload) => payload.hook_event_name === 'agent_end')
      expect(posts.filter((payload) => payload.hook_event_name === 'agent_end')).toHaveLength(1)
      expect(posts[completionIndex + 1]).toMatchObject({
        hook_event_name: 'subagents_update',
        omp_status: { state: 'done' },
        subagents: []
      })
    } finally {
      snapshot?.resolve()
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('recovers latest facts after 80 offline scopes and a failed old close', async () => {
    const root = nativeRoot('scope-0', true)
    let online = true
    let active = 0
    let maxActive = 0
    let heldClose: PromiseWithResolvers<void> | undefined
    const fixture = createNativeFixture(root, [nativeChild('ScopeChild', root.file)], {
      env: CONSUMER_ENV,
      delivery: async (payload) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        try {
          if (!online) {
            if (!heldClose && payload.session_boundary) {
              heldClose = Promise.withResolvers<void>()
              await heldClose.promise
            }
            throw new Error('receiver offline')
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 40))
          return receive(payload)
        } finally {
          active -= 1
        }
      }
    })
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('before_agent_start', { prompt: 'old scope' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'bash', args: { command: 'printf old-scope' } },
        root.context
      )
      await fixture.harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: [{ type: 'text', text: 'old scope answer' }] } },
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
          nativeChild('ScopeChild', root.file, Date.now(), `child-${scope}`)
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
      if (!heldClose) {
        throw new Error('Expected the original close to remain in flight')
      }
      root.ref.status = 'idle'
      root.session.isStreaming = false
      fixture.setStatus(fixture.refs.get('ScopeChild')!, 'idle')
      await fixture.harness.callHook('agent_end', {}, root.context)
      await vi.advanceTimersByTimeAsync(300)
      await fixture.harness.callHook(
        'model_select',
        { model: { provider: 'orca-fixture', id: 'current-model' } },
        root.context
      )
      const beforeRecovery = fixture.accepted.length
      const recoveredAt = Date.now()
      online = true
      heldClose.reject(new Error('lost old connection'))
      await vi.advanceTimersByTimeAsync(2_000)

      const current = rows.at(-1)!
      expect(current).toMatchObject({
        state: 'done',
        prompt: 'scope-80 prompt',
        model: 'orca-fixture/current-model',
        mainAgent: { state: 'done' },
        providerSession: { id: 'scope-80', transcriptPath: '/sessions/scope-80.jsonl' }
      })
      expect(current.subagents ?? []).toEqual([])
      expect(current.toolName).toBeUndefined()
      expect(current.toolInput).toBeUndefined()
      expect(current.lastAssistantMessage).toBeUndefined()
      expect(current.receivedAt).toBeLessThanOrEqual(recoveredAt + 2_000)
      expect(maxActive).toBe(1)
      const currentRows = rows.filter((row) => row.providerSession?.id === 'scope-80')
      expect(
        currentRows.every(
          (row) =>
            row.prompt !== 'old scope' &&
            row.toolInput !== 'printf old-scope' &&
            row.lastAssistantMessage !== 'old scope answer'
        )
      ).toBe(true)
      expect(
        rows
          .filter((row) => row.state === 'done' && !row.sessionBoundary)
          .every((row) => row.providerSession?.id === 'scope-80')
      ).toBe(true)
      const recovered = fixture.accepted.slice(beforeRecovery).map(({ payload }) => payload)
      expect(recovered.length).toBeLessThanOrEqual(6)
      const closeIndex = recovered.findIndex(
        (payload) => payload.session_id === 'scope-79' && payload.session_boundary
      )
      const currentIndex = recovered.findIndex((payload) => payload.session_id === 'scope-80')
      expect(closeIndex).toBeGreaterThanOrEqual(0)
      expect(currentIndex).toBeGreaterThan(closeIndex)
      expect(
        recovered.slice(currentIndex).every((payload) => payload.session_id === 'scope-80')
      ).toBe(true)
      const completionIndex = recovered.findIndex(
        (payload) => payload.hook_event_name === 'agent_end' && payload.session_id === 'scope-80'
      )
      expect(completionIndex).toBeGreaterThan(closeIndex)
      expect(recovered[completionIndex + 1]).toMatchObject({
        hook_event_name: 'subagents_update',
        omp_status: { state: 'done' },
        subagents: []
      })
    } finally {
      online = true
      heldClose?.resolve()
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(100)
    }
  })

  it('settles the exact Pi-routed completion after a close is requeued ahead of it', async () => {
    const root = nativeRoot('queued-A', true)
    let inFlight: PromiseWithResolvers<void> | undefined
    const fixture = createNativeFixture(root, [], {
      runtime: { kind: 'pi', argv: ['bun', '/opt/omp/bin/omp'] },
      env: CONSUMER_ENV,
      delivery: async (payload) => {
        if (!inFlight && payload.hook_event_name === 'agent_end' && !payload.session_boundary) {
          inFlight = Promise.withResolvers<void>()
          await inFlight.promise
        }
        return receive(payload)
      }
    })
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('before_agent_start', { prompt: 'first A turn' }, root.context)
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

      const posts = fixture.accepted.map(({ payload }) => payload)
      expect(
        posts.filter(
          (payload) => payload.hook_event_name === 'agent_end' && !payload.session_boundary
        )
      ).toEqual([expect.objectContaining({ session_id: 'queued-A' })])
      const closeIndex = posts.findIndex(
        (payload) => payload.session_id === 'queued-A' && payload.session_boundary
      )
      const currentIndex = posts.findIndex((payload) => payload.session_id === 'queued-B')
      expect(closeIndex).toBeGreaterThanOrEqual(0)
      expect(currentIndex).toBeGreaterThan(closeIndex)
      expect(posts.slice(currentIndex).every((payload) => payload.session_id === 'queued-B')).toBe(
        true
      )
      expect(rows.at(-1)).toMatchObject({
        state: 'working',
        prompt: 'latest B turn',
        providerSession: { id: 'queued-B', transcriptPath: '/sessions/queued-B.jsonl' }
      })
    } finally {
      inFlight?.resolve()
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})
