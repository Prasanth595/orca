import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { buildLegacyAgentChildRowModels } from '../../shared/agent-child-row-model'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  isFreshNonDoneAgentStatus
} from '../../shared/agent-status-types'
import { AgentHookServer } from '../agent-hooks/server'
import { PANE } from '../agent-hooks/server.test-fixtures'
import {
  NATIVE_TIME,
  createNativeFixture,
  nativeChild,
  nativeRoot,
  type DeliveredPost,
  type NativeRef,
  type NativeRoot
} from './agent-status-extension-omp-registry-fixture'
import type { HookContext } from './agent-status-extension-test-harness'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

function snapshot(posts: DeliveredPost[]): DeliveredPost {
  const post = posts.findLast(({ payload }) => payload.hook_event_name === 'subagents_update')
  if (!post) {
    throw new Error('Expected a verified native snapshot')
  }
  return post
}

// Only the clock, aggregate-state and human-input cases need the real host consumer.
function createNativeConsumer(root: NativeRoot, children: NativeRef[] = []) {
  const server = new AgentHookServer()
  const fixture = createNativeFixture(root, children, {
    env: {
      ORCA_AGENT_HOOK_ENV: 'production',
      ORCA_PANE_KEY: PANE,
      ORCA_TAB_ID: 'tab-1',
      ORCA_WORKTREE_ID: 'wt-1',
      ORCA_AGENT_LAUNCH_TOKEN: undefined
    },
    delivery: async (payload) => {
      const event = normalizeHookPayload(
        server._getStateForTests(),
        'omp',
        { paneKey: PANE, tabId: 'tab-1', worktreeId: 'wt-1', payload },
        'production'
      )
      if (event) {
        server.ingestRemote(event, null)
      }
      return { ok: true }
    }
  })
  return {
    fixture,
    server,
    consume() {
      const row = server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
      if (!row) {
        throw new Error('Expected an admitted native OMP status')
      }
      return row
    }
  }
}

describe('OMP native registry guarantees', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('bootstraps named missed starts, refreshes quiet evidence and leaves a new unprompted scope idle', async () => {
    const root = nativeRoot('quiet-root')
    const children = [nativeChild('NamedLeft', root.file), nativeChild('NamedRight', root.file)]
    const { fixture, consume, server } = createNativeConsumer(root, children)
    const { harness, delivered } = fixture
    try {
      // No lifecycle start is replayed; both native display names deliberately repeat.
      await harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(delivered).payload).toMatchObject({
        session_id: 'quiet-root',
        session_file: root.file,
        omp_status: { state: 'done', session_boundary: true },
        subagents: expect.arrayContaining(
          children.map((child) =>
            expect.objectContaining({
              id: child.id,
              description: child.id,
              agentType: 'registry-proof',
              state: 'working',
              startedAt: child.createdAt
            })
          )
        )
      })
      const initial = consume()
      expect(initial).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })
      expect(initial.turnStartedAt).toBeUndefined()
      await vi.advanceTimersByTimeAsync(12_000)
      const quiet = consume()
      expect(quiet.receivedAt).toBeGreaterThan(initial.receivedAt)
      expect(quiet.stateStartedAt).toBe(initial.stateStartedAt)
      expect(quiet.mainAgent?.stateStartedAt).toBe(initial.mainAgent?.stateStartedAt)
      expect(quiet.turnStartedAt).toBeUndefined()

      root.session.isStreaming = true
      await harness.callHook(
        'before_agent_start',
        { prompt: 'Inspect the native work.' },
        root.context
      )
      await harness.callHook('agent_start', {}, root.context)
      await harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: [{ type: 'text', text: 'Root progress.' }] } },
        root.context
      )
      await harness.callHook(
        'tool_execution_start',
        { toolName: 'read', args: { path: 'src/native.ts' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      const working = consume()
      expect(working.turnStartedAt).toEqual(expect.any(Number))
      await vi.advanceTimersByTimeAsync(12_000)
      const refreshed = consume()
      expect(refreshed.receivedAt).toBeGreaterThan(working.receivedAt)
      expect(refreshed).toMatchObject({
        state: 'working',
        stateStartedAt: working.stateStartedAt,
        turnStartedAt: working.turnStartedAt,
        prompt: 'Inspect the native work.',
        toolName: 'read',
        toolInput: working.toolInput,
        lastAssistantMessage: 'Root progress.'
      })
      expect(snapshot(delivered).payload.subagents?.map(({ startedAt }) => startedAt)).toEqual(
        children.map(({ createdAt }) => createdAt)
      )

      const previousSessionFile = root.file
      root.replaceSession('unprompted-root')
      await harness.callHook('session_switch', { reason: 'new', previousSessionFile }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const idle = consume()
      expect(root.ref.status).toBe('running')
      expect(idle).toMatchObject({
        state: 'done',
        sessionBoundary: true,
        prompt: '',
        mainAgent: { state: 'done' },
        providerSession: { id: 'unprompted-root', transcriptPath: root.file }
      })
      expect(idle.turnStartedAt).toBeUndefined()
      expect(idle.toolName).toBeUndefined()
      expect(snapshot(delivered).payload.subagents).toEqual([])
    } finally {
      await harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      server.stop()
    }
  })

  it('keeps idle async work alive beyond the payload cap through resume, cancellation and final settlement', async () => {
    const root = nativeRoot('async-root')
    let rootPending = true
    root.ref.status = 'idle'
    root.session.hasPendingAsyncWork = () => rootPending
    const children = Array.from({ length: 40 }, (_, index) =>
      nativeChild(`Child${index}`, root.file, NATIVE_TIME - 100 + index)
    )
    const { fixture, consume, server } = createNativeConsumer(root, children)
    const { harness, delivered } = fixture
    try {
      await harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'working' } })
      const shown = snapshot(delivered).payload.subagents!.map(({ id }) => id)
      expect(shown).toHaveLength(32)
      const hidden = children.find(({ id }) => !shown.includes(id))!
      const cancelled = children.find((child) => child !== hidden)!
      let childPending = true
      hidden.session.hasPendingAsyncWork = () => childPending
      await harness.callHook(
        'before_agent_start',
        { prompt: 'Wait for all native children.' },
        root.context
      )
      await harness.callHook('agent_start', {}, root.context)
      rootPending = false
      await harness.callHook('agent_end', { willContinue: false }, root.context)
      for (const child of children) {
        fixture.setStatus(child, child === cancelled ? 'aborted' : 'idle')
      }
      expect(hidden.lifecycle?.terminalAt).toBe(Date.now())
      await vi.advanceTimersByTimeAsync(6_000)
      expect(delivered.some(({ payload }) => payload.hook_event_name === 'agent_end')).toBe(false)
      expect(consume()).toMatchObject({
        state: 'working',
        mainAgent: { state: 'done' },
        subagents: [expect.objectContaining({ id: hidden.id, state: 'working' })]
      })
      expect(snapshot(delivered).payload.subagents?.map(({ id }) => id)).toEqual([hidden.id])

      childPending = false
      hidden.session.isStreaming = true
      fixture.setStatus(hidden, 'running')
      expect(hidden.lifecycle).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume().state).toBe('working')
      fixture.setStatus(hidden, 'idle')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(delivered).payload.subagents).toEqual([])
      expect(consume()).toMatchObject({ state: 'done', mainAgent: { state: 'done' } })
      expect(
        delivered.find(({ payload }) => payload.hook_event_name === 'agent_end')?.payload
      ).toMatchObject({
        session_id: 'async-root',
        session_file: root.file
      })
    } finally {
      await harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      server.stop()
    }
  })

  it('seeds an untouched root from native execution only after an unavailable read recovers', async () => {
    const root = nativeRoot('unreadable-root')
    let unavailable = true
    root.session.hasPendingAsyncWork = () => {
      if (unavailable) {
        throw new Error('Native execution unavailable')
      }
      return true
    }
    const { harness, delivered } = createNativeFixture(root, [])
    try {
      await harness.callHook('session_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(delivered).toEqual([])
      unavailable = false
      await vi.advanceTimersByTimeAsync(6_000)
      expect(snapshot(delivered).payload.omp_status).toEqual({
        state: 'working',
        session_boundary: true
      })
    } finally {
      await harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
    }
  })

  it('recovers an unavailable initial read without replacing captured asks, approval reasons or wait clocks', async () => {
    const root = nativeRoot('human-wait-root')
    root.context.hasUI = true
    let unreadable = true
    root.session.hasPendingAsyncWork = () => {
      if (unreadable) {
        throw new Error('Native work state is not ready')
      }
      return true
    }
    const child = nativeChild('UnrelatedChild', root.file)
    const { fixture, consume, server } = createNativeConsumer(root, [child])
    const { harness, delivered } = fixture
    const reason = 'Allow inspection of the selected workspace?'
    const questions = {
      questions: [{ id: 'scope', question: 'Which scope?', options: [{ label: 'Workspace' }] }]
    }
    try {
      await harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(delivered).toEqual([])
      await harness.callHook(
        'before_agent_start',
        { prompt: 'Inspect the selected scope.' },
        root.context
      )
      await harness.callHook(
        'tool_execution_start',
        { toolName: 'ask', args: questions },
        root.context
      )
      await harness.callHook('tool_approval_requested', { toolName: 'bash', reason }, root.context)
      await harness.callHook(
        'tool_execution_start',
        { toolName: 'bash', args: { command: 'printf unrelated' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(delivered.some(({ payload }) => payload.hook_event_name === 'subagents_update')).toBe(
        false
      )

      // Recovery is a silent native read, not another prompt or lifecycle replay.
      unreadable = false
      await vi.advanceTimersByTimeAsync(6_000)
      const asking = consume()
      expect(asking).toMatchObject({
        state: 'blocked',
        prompt: 'Inspect the selected scope.',
        toolName: 'ask',
        interactivePrompt: JSON.stringify(questions)
      })
      expect(asking.turnStartedAt).toBeUndefined()

      harness.reload()
      await harness.callHook('session_start', { reason: 'reload' }, root.context)
      const childFactory = harness.registerTaskChild()
      const childContext: HookContext = {
        agent: { id: child.id, kind: 'sub', parentId: 'Main', depth: 1 },
        sessionManager: child.session.sessionManager,
        isIdle: () => false
      }
      await childFactory.callHook('session_start', { reason: 'startup' }, childContext)
      await childFactory.callHook('tool_execution_start', { toolName: 'read' }, childContext)
      await childFactory.callHook('tool_execution_end', { toolName: 'read' }, childContext)
      await vi.advanceTimersByTimeAsync(6_000)
      const retained = consume()
      expect(retained).toMatchObject({
        state: 'blocked',
        toolName: 'ask',
        interactivePrompt: asking.interactivePrompt,
        stateStartedAt: asking.stateStartedAt
      })
      expect(retained.turnStartedAt).toBe(asking.turnStartedAt)

      await harness.callHook('tool_execution_end', { toolName: 'ask' }, root.context)
      await harness.callHook('tool_execution_start', { toolName: 'bash' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const approval = consume()
      expect(approval).toMatchObject({
        state: 'blocked',
        toolName: 'bash',
        toolInput: reason
      })
      expect(approval.turnStartedAt).toBe(asking.turnStartedAt)
      expect(approval.interactivePrompt).toBeUndefined()
      harness.reload()
      await harness.callHook('session_start', { reason: 'reload' }, root.context)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(consume()).toMatchObject({ state: 'blocked', toolName: 'bash', toolInput: reason })
      await harness.callHook(
        'tool_approval_resolved',
        { toolName: 'bash', approved: true },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      const resumed = consume()
      expect(resumed.state).toBe('working')
      expect(resumed.turnStartedAt).toBe(asking.turnStartedAt)
      expect(resumed.interactivePrompt).toBeUndefined()
    } finally {
      await harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      server.stop()
    }
  })

  it('fences replaced native roots, child factories and dispatched callbacks while rebinding the current scope', async () => {
    const before = nativeRoot('before-root', true)
    const oldChild = nativeChild('Worker', before.file)
    let acceptDelivery = true
    const fixture = createNativeFixture(before, [oldChild], {
      delivery: async () => (acceptDelivery ? { ok: true } : { ok: false, status: 503 })
    })
    const { harness, delivered, accepted } = fixture
    const after = nativeRoot('after-root', true)
    const replacement = harness.registerTaskChild()
    try {
      await harness.callHook('session_start', { reason: 'startup' }, before.context)
      await harness.callHook(
        'before_agent_start',
        { prompt: 'Only the old root owns this.' },
        before.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      const verified = snapshot(accepted)
      const childFactory = harness.registerTaskChild()
      const childContext: HookContext = {
        agent: { id: oldChild.id, kind: 'sub', parentId: 'Main', depth: 1 },
        sessionManager: oldChild.session.sessionManager
      }
      await childFactory.callHook('session_start', { reason: 'startup' }, childContext)
      // An explicit Main label cannot substitute for the exact native manager.
      await childFactory.callHook('session_start', { reason: 'startup' }, after.context)
      await childFactory.callHook('session_shutdown', { reason: 'quit' }, after.context)
      expect(snapshot(accepted)).toBe(verified)
      const queued = nativeChild('QueuedOldWorker', before.file)
      fixture.refs.set(queued.id, queued)
      acceptDelivery = false
      fixture.notify('registered', queued)
      await vi.advanceTimersByTimeAsync(200)
      expect(snapshot(delivered).payload.subagents).toHaveLength(2)
      const staleCallback = fixture.captureNotification()
      fixture.notify('metadata_changed', oldChild)
      fixture.refs.set(after.ref.id, after.ref)
      const newChild = nativeChild('Worker', after.file)
      fixture.refs.set(newChild.id, newChild)
      staleCallback('registered', newChild)
      await vi.advanceTimersByTimeAsync(200)
      acceptDelivery = true
      await vi.advanceTimersByTimeAsync(6_000)
      expect(snapshot(accepted)).toBe(verified)

      // A fresh factory proves the replacement manager; the obsolete Main still drains.
      await replacement.callHook('session_start', { reason: 'startup' }, after.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(delivered).payload).toMatchObject({
        session_id: 'after-root',
        session_file: after.file,
        omp_status: { state: 'working', session_boundary: true },
        subagents: [expect.objectContaining({ id: 'Worker' })]
      })
      expect(snapshot(delivered).payload.omp_status).not.toHaveProperty('prompt')
      const rebound = snapshot(delivered)
      await harness.callHook('session_start', { reason: 'reload' }, before.context)
      await harness.callHook('session_shutdown', { reason: 'quit' }, before.context)
      await childFactory.callHook('session_shutdown', { reason: 'quit' }, childContext)
      staleCallback('metadata_changed', oldChild)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(snapshot(delivered).observedAt).toBeGreaterThan(rebound.observedAt)
      expect(snapshot(delivered).payload.session_id).toBe('after-root')

      // Native Main may have parentSession; same-manager resume still changes scope.
      const previousSessionFile = after.file
      after.replaceSession('resumed-root', previousSessionFile)
      await replacement.callHook(
        'session_switch',
        { reason: 'resume', previousSessionFile },
        after.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(delivered).payload).toMatchObject({
        session_id: 'resumed-root',
        session_file: after.file,
        omp_status: { state: 'done', session_boundary: true },
        subagents: []
      })
      const resumedChild = nativeChild('Worker', after.file, Date.now(), 'resumed-worker')
      fixture.refs.set(resumedChild.id, resumedChild)
      fixture.notify('registered', resumedChild)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(delivered).payload.subagents).toEqual([
        expect.objectContaining({ id: 'Worker', startedAt: resumedChild.createdAt })
      ])
      const shutdownCallback = fixture.captureNotification()
      const last = delivered.at(-1)
      fixture.notify('metadata_changed', resumedChild)
      await replacement.callHook('session_shutdown', { reason: 'quit' }, after.context)
      shutdownCallback('metadata_changed', resumedChild)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(delivered.at(-1)).toBe(last)
    } finally {
      await replacement.callHook('session_shutdown', { reason: 'quit' }, after.context)
    }
  })

  it('recomputes shared inactive ancestry without admitting foreign, stale, cyclic or terminal refs', async () => {
    const root = nativeRoot('ancestry-root')
    const ancestors: NativeRef[] = []
    let parentId = root.ref.id
    for (let index = 0; index < 640; index++) {
      const ancestor = nativeChild(`Ancestor${index}`, root.file)
      ancestor.parentId = parentId
      ancestor.status = 'idle'
      ancestor.session.isStreaming = false
      ancestor.lifecycle = { terminalAt: NATIVE_TIME - 10 }
      ancestors.push(ancestor)
      parentId = ancestor.id
    }
    const shared = ancestors.at(-1)!
    const leaves = ['Left', 'Right'].map((id) => {
      const child = nativeChild(id, shared.sessionFile)
      child.parentId = shared.id
      return child
    })
    const foreignRoot = nativeRoot('foreign-root', true)
    foreignRoot.ref.id = 'OtherMain'
    const foreign = nativeChild('ForeignAncestor', root.file)
    foreign.parentId = foreignRoot.ref.id
    foreign.status = 'idle'
    foreign.session.isStreaming = false
    const foreignLeaf = nativeChild('ForeignLeaf', root.file)
    foreignLeaf.parentId = foreign.id
    foreignLeaf.session.isStreaming = false
    foreignLeaf.session.hasPendingAsyncWork = () => {
      throw new Error('Foreign work cannot make our native read unavailable')
    }
    const stale = nativeChild('OldAncestor', '/sessions/old-root.jsonl')
    stale.status = 'idle'
    stale.session.isStreaming = false
    const staleLeaf = nativeChild('CurrentPathUnderOldAncestor', root.file)
    staleLeaf.parentId = stale.id
    const cycle = ['CycleLeft', 'CycleRight'].map((id) => nativeChild(id, root.file))
    cycle[0]!.parentId = cycle[1]!.id
    cycle[1]!.parentId = cycle[0]!.id
    const excluded = ['parked', 'aborted', 'advisor', 'settled'].map((kind) => {
      const ref = nativeChild(kind, root.file)
      if (kind === 'advisor') {
        ref.kind = 'advisor'
      } else if (kind === 'settled') {
        ref.session.isStreaming = false
        ref.lifecycle = { acceptedAt: NATIVE_TIME - 1, terminalAt: NATIVE_TIME - 1 }
      } else {
        ref.status = kind
      }
      return ref
    })
    const fixture = createNativeFixture(root, [
      ...ancestors,
      ...leaves,
      foreignRoot.ref,
      foreign,
      foreignLeaf,
      stale,
      staleLeaf,
      ...cycle,
      ...excluded
    ])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(
        snapshot(fixture.delivered)
          .payload.subagents?.map(({ id }) => id)
          .sort()
      ).toEqual(['Left', 'Right'])
      const currentFile = shared.sessionFile
      const currentParent = shared.parentId
      shared.sessionFile = '/sessions/old-root/Ancestor.jsonl'
      fixture.notify('metadata_changed', shared)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(fixture.delivered).payload.subagents).toEqual([])
      shared.sessionFile = currentFile
      shared.parentId = foreignRoot.ref.id
      fixture.notify('metadata_changed', shared)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(fixture.delivered).payload.subagents).toEqual([])
      shared.parentId = currentParent
      fixture.notify('metadata_changed', shared)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(
        snapshot(fixture.delivered)
          .payload.subagents?.map(({ id }) => id)
          .sort()
      ).toEqual(['Left', 'Right'])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
    }
  })

  it('ages old evidence through failed reads and attaching shared ancestry until a native-silent recovery', async () => {
    const root = nativeRoot('uncertain-root', true)
    const first = nativeChild('PreviouslyVerified', root.file)
    let acceptDelivery = true
    const fixture = createNativeFixture(root, [first], {
      delivery: async () => (acceptDelivery ? { ok: true } : { ok: false, status: 503 })
    })
    const { harness, delivered, accepted } = fixture
    try {
      await harness.callHook('session_start', { reason: 'startup' }, root.context)
      await harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      root.session.isStreaming = false
      await harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const verified = snapshot(accepted)
      const queued = nativeChild('UnacceptedChild', root.file)
      fixture.refs.set(queued.id, queued)
      acceptDelivery = false
      fixture.notify('registered', queued)
      await vi.advanceTimersByTimeAsync(200)
      expect(snapshot(delivered).payload.subagents).toHaveLength(2)
      fixture.failList(new Error('Native enumeration is unavailable'))
      fixture.setStatus(first, 'idle')
      fixture.setStatus(queued, 'idle')
      await vi.advanceTimersByTimeAsync(200)
      acceptDelivery = true
      await vi.advanceTimersByTimeAsync(12_000)
      expect(snapshot(accepted)).toBe(verified)
      vi.setSystemTime(verified.observedAt + AGENT_STATUS_STALE_AFTER_MS + 1)
      expect(
        buildLegacyAgentChildRowModels(verified.payload.subagents ?? [], {
          parentEvidenceFresh: isFreshNonDoneAgentStatus(
            { state: 'working', updatedAt: verified.observedAt },
            Date.now()
          ),
          transportObservation: 'live',
          parentObservedAt: verified.observedAt,
          hostClockOffsetMs: 0
        })
      ).toEqual([expect.objectContaining({ id: first.id, displayState: 'unverifiable' })])

      fixture.failList()
      root.session.hasPendingAsyncWork = () => {
        throw new Error('Root execution is unavailable')
      }
      await vi.advanceTimersByTimeAsync(6_000)
      expect(snapshot(accepted)).toBe(verified)
      root.session.hasPendingAsyncWork = () => false
      first.session.hasPendingAsyncWork = () => {
        throw new Error('Child execution is unavailable')
      }
      await vi.advanceTimersByTimeAsync(6_000)
      expect(snapshot(accepted)).toBe(verified)
      first.session.hasPendingAsyncWork = () => false

      const ancestor: NativeRef = nativeChild('AttachingAncestor', root.file)
      const attachedSession = ancestor.session!
      const attachedFile = ancestor.sessionFile
      const descendants = ['AttachedLeft', 'AttachedRight'].map((id) => {
        const child = nativeChild(id, attachedFile)
        child.parentId = ancestor.id
        return child
      })
      ancestor.session = null
      ancestor.sessionFile = ''
      for (const ref of [ancestor, ...descendants]) {
        fixture.refs.set(ref.id, ref)
      }
      fixture.notify('registered', ancestor)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(snapshot(accepted)).toBe(verified)
      expect(delivered.some(({ payload }) => payload.hook_event_name === 'agent_end')).toBe(false)

      // attachSession emits no registry callback. Shared pending ownership must not stick.
      ancestor.session = attachedSession
      ancestor.sessionFile = attachedFile
      ancestor.status = 'idle'
      attachedSession.isStreaming = false
      await vi.advanceTimersByTimeAsync(6_000)
      expect(
        snapshot(delivered)
          .payload.subagents?.map(({ id }) => id)
          .sort()
      ).toEqual(['AttachedLeft', 'AttachedRight'])
      expect(snapshot(delivered).observedAt).toBeGreaterThan(verified.observedAt)
      const recovered = snapshot(accepted)
      acceptDelivery = false
      fixture.setStatus(descendants[0]!, 'idle')
      fixture.setStatus(descendants[1]!, 'aborted')
      await vi.advanceTimersByTimeAsync(200)
      // A retained real completion is not an explicit closing boundary: read loss holds its retry too.
      fixture.failList(new Error('Native read failed before completion was acknowledged'))
      fixture.notify('metadata_changed', root.ref)
      await vi.advanceTimersByTimeAsync(200)
      acceptDelivery = true
      await vi.advanceTimersByTimeAsync(100)
      expect(accepted.at(-1)).toBe(recovered)
      fixture.failList()
      fixture.notify('metadata_changed', root.ref)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(snapshot(delivered).payload).toMatchObject({
        session_id: 'uncertain-root',
        omp_status: { state: 'done' },
        subagents: []
      })
      const completion = accepted.find(({ payload }) => payload.hook_event_name === 'agent_end')
      expect(completion?.payload.session_id).toBe('uncertain-root')
      expect(completion?.payload).not.toHaveProperty('session_boundary')
    } finally {
      await harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
    }
  })
})
