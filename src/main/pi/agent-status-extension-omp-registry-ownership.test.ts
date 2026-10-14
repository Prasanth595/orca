import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  NATIVE_TIME,
  childIds,
  childRows,
  createNativeFixture,
  latestSnapshot,
  nativeChild,
  nativeRoot,
  postedPayloads,
  type NativeDeliveryResponse,
  type NativeRef
} from './agent-status-extension-omp-registry-fixture'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

describe('OMP native registry root ownership and session acknowledgement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('stops queued native updates and already-dispatched callbacks on root shutdown', async () => {
    const root = nativeRoot('shutdown-root', true)
    const child = nativeChild('ShutdownChild', root.file)
    const lateChild = nativeChild('LateChild', root.file, NATIVE_TIME - 46)
    const fixture = createNativeFixture(root, [child])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const staleNotification = fixture.captureNotification()
      fixture.refs.set(lateChild.id, lateChild)
      fixture.notify('registered', lateChild)

      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      const afterShutdown = fixture.delivered.length
      staleNotification('registered', lateChild)
      fixture.notify('metadata_changed', child)
      await vi.advanceTimersByTimeAsync(12_000)

      expect(fixture.delivered.slice(afterShutdown)).toEqual([])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('retires an observer whose exact native root is replaced and publishes only the rebound session', async () => {
    const before = nativeRoot('replaced-root', true)
    const after = nativeRoot('replacement-root', true)
    const oldChild = nativeChild('OldRootChild', before.file)
    const newChild = nativeChild('ReplacementChild', after.file, NATIVE_TIME - 46)
    const fixture = createNativeFixture(before, [oldChild])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, before.context)
      await fixture.harness.callHook(
        'before_agent_start',
        { prompt: 'This prompt belongs only to the replaced root.' },
        before.context
      )
      await fixture.harness.callHook('agent_start', {}, before.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const staleNotification = fixture.captureNotification()
      const beforeReplacement = fixture.delivered.length
      fixture.notify('metadata_changed', oldChild)
      fixture.refs.set(after.ref.id, after.ref)
      fixture.refs.set(newChild.id, newChild)
      staleNotification('registered', newChild)
      await vi.advanceTimersByTimeAsync(6_000)

      // The previous context has lost exact registry ownership; even its queued
      // callback cannot renew an old identity while waiting for the new root hook.
      expect(fixture.delivered.slice(beforeReplacement)).toEqual([])
      await fixture.harness.callHook(
        'session_switch',
        { reason: 'new', previousSessionFile: before.file },
        after.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(latestSnapshot(fixture).payload).toMatchObject({
        session_id: 'replacement-root',
        session_file: after.file,
        omp_status: { state: 'working', session_boundary: true }
      })
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['ReplacementChild'])
      expect(latestSnapshot(fixture).payload.omp_status).not.toHaveProperty('prompt')

      const afterRebind = fixture.delivered.length
      staleNotification('metadata_changed', oldChild)
      fixture.notify('metadata_changed', oldChild)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(latestSnapshot(fixture).observedAt).toBeGreaterThan(
        fixture.delivered[afterRebind - 1].observedAt
      )
      for (const { payload } of fixture.delivered.slice(afterRebind)) {
        expect(payload.session_id).toBe('replacement-root')
        expect(payload.session_file).toBe(after.file)
        expect(childIds(payload)).toEqual(['ReplacementChild'])
        expect(payload.omp_status?.prompt).not.toBe(
          'This prompt belongs only to the replaced root.'
        )
      }
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, after.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it.each([
    'registry root replacement',
    'root session replacement',
    'registry root removal'
  ] as const)(
    'does not deliver queued native evidence after %s until a new root is proven',
    async (loss) => {
      const before = nativeRoot('unowned-before', true)
      const after = nativeRoot('unowned-after', true)
      const firstOldChild = nativeChild('AcceptedOldRootChild', before.file)
      const secondOldChild = nativeChild('FailedOldRootChild', before.file, NATIVE_TIME - 46)
      const newChild = nativeChild('ProvenNewRootChild', after.file, NATIVE_TIME - 45)
      let acceptSnapshots = true
      const fixture = createNativeFixture(before, [firstOldChild], {
        delivery: async (payload) =>
          payload.hook_event_name === 'subagents_update' && !acceptSnapshots
            ? { ok: false, status: 503 }
            : { ok: true }
      })
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, before.context)
        await fixture.harness.callHook('agent_start', {}, before.context)
        await vi.advanceTimersByTimeAsync(1_000)
        const verified = fixture.accepted.findLast(
          ({ payload }) => payload.hook_event_name === 'subagents_update'
        )
        if (!verified) {
          throw new Error('Expected an accepted native roster before ownership loss')
        }
        expect(childIds(verified.payload)).toEqual(['AcceptedOldRootChild'])

        acceptSnapshots = false
        const beforeFailedUpdate = fixture.delivered.length
        fixture.refs.set(secondOldChild.id, secondOldChild)
        fixture.notify('registered', secondOldChild)
        await vi.advanceTimersToNextTimerAsync()
        const failed = fixture.delivered
          .slice(beforeFailedUpdate)
          .find(({ payload }) => payload.hook_event_name === 'subagents_update')
        if (!failed) {
          throw new Error('Expected a failed full native snapshot before ownership loss')
        }
        expect(childIds(failed.payload)).toEqual(['AcceptedOldRootChild', 'FailedOldRootChild'])
        expect(failed.payload.omp_status).toMatchObject({ state: 'working' })

        const beforeOwnershipLoss = fixture.accepted.length
        fixture.refs.set(newChild.id, newChild)
        if (loss === 'registry root replacement') {
          fixture.refs.set(after.ref.id, after.ref)
          fixture.notify('metadata_changed', after.ref)
        } else if (loss === 'root session replacement') {
          before.ref.session = after.session
          before.ref.sessionFile = after.file
          fixture.notify('metadata_changed', before.ref)
        } else {
          fixture.refs.delete(before.ref.id)
          fixture.notify('removed', before.ref)
        }
        // Native reconciliation sees the exact-root loss before the pending HTTP retry.
        // No new root context has authorized another scope or a legacy fallback.
        await vi.advanceTimersToNextTimerAsync()
        acceptSnapshots = true
        await vi.advanceTimersByTimeAsync(2_000)
        expect(fixture.accepted.slice(beforeOwnershipLoss)).toEqual([])
        expect(childIds(verified.payload)).toEqual(['AcceptedOldRootChild'])
        expect(verified.payload.omp_status).toMatchObject({ state: 'working' })

        const beforeNewProof = fixture.accepted.length
        fixture.refs.set(after.ref.id, after.ref)
        await fixture.harness.callHook(
          'session_switch',
          { reason: 'new', previousSessionFile: before.file },
          after.context
        )
        await vi.advanceTimersByTimeAsync(1_000)
        const proven = fixture.accepted
          .slice(beforeNewProof)
          .find(
            ({ payload }) =>
              payload.hook_event_name === 'subagents_update' &&
              payload.session_id === 'unowned-after'
          )
        if (!proven) {
          throw new Error('Expected an accepted snapshot for the newly proven root')
        }
        expect(proven.payload).toMatchObject({
          session_id: 'unowned-after',
          session_file: after.file,
          omp_status: { state: 'working', session_boundary: true }
        })
        expect(childIds(proven.payload)).toEqual(['ProvenNewRootChild'])
        expect(childRows(proven.payload, proven.observedAt)).toEqual([
          expect.objectContaining({
            id: 'ProvenNewRootChild',
            name: 'ProvenNewRootChild',
            displayState: 'working'
          })
        ])

        await vi.advanceTimersByTimeAsync(6_000)
        for (const { payload } of fixture.accepted.slice(beforeNewProof)) {
          if (payload.session_id === 'unowned-before') {
            expect(payload).toMatchObject({
              hook_event_name: 'agent_end',
              session_file: before.file,
              session_boundary: true
            })
          } else {
            expect(payload.session_id).toBe('unowned-after')
            expect(payload.session_file).toBe(after.file)
            expect(childIds(payload)).toEqual(['ProvenNewRootChild'])
            expect(payload.omp_status).toMatchObject({ state: 'working' })
          }
        }
      } finally {
        acceptSnapshots = true
        fixture.refs.set(after.ref.id, after.ref)
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, after.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it.each(['failed delivery', 'missing endpoint'] as const)(
    'retains replacement-session proof across %s and a real root turn',
    async (interruption) => {
      const root = nativeRoot('unacknowledged-before')
      const beforeFile = root.file
      const afterId = 'unacknowledged-after'
      const afterFile = `/sessions/${afterId}.jsonl`
      const oldChild = nativeChild('BeforeUnacknowledgedChild', beforeFile)
      const newChild = nativeChild('AfterUnacknowledgedChild', afterFile, NATIVE_TIME - 46)
      let acceptNewSnapshots = false
      const fixture = createNativeFixture(root, [oldChild], {
        delivery: async (payload) =>
          payload.hook_event_name === 'subagents_update' &&
          payload.session_id === afterId &&
          !acceptNewSnapshots
            ? { ok: false, status: 503 }
            : { ok: true }
      })
      const port = fixture.harness.processEnv.ORCA_AGENT_HOOK_PORT
      const token = fixture.harness.processEnv.ORCA_AGENT_HOOK_TOKEN
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(
          fixture.accepted.some(
            ({ payload }) =>
              payload.hook_event_name === 'subagents_update' &&
              payload.session_id === 'unacknowledged-before'
          )
        ).toBe(true)
        if (interruption === 'missing endpoint') {
          fixture.harness.processEnv.ORCA_AGENT_HOOK_PORT = undefined
          fixture.harness.processEnv.ORCA_AGENT_HOOK_TOKEN = undefined
        }
        root.replaceSession(afterId)
        fixture.refs.set(newChild.id, newChild)
        await fixture.harness.callHook(
          'session_switch',
          { reason: 'new', previousSessionFile: beforeFile },
          root.context
        )
        await vi.advanceTimersByTimeAsync(1_000)
        expect(
          fixture.accepted.filter(
            ({ payload }) =>
              payload.hook_event_name === 'subagents_update' && payload.session_id === afterId
          )
        ).toEqual([])
        if (interruption === 'failed delivery') {
          expect(
            fixture.delivered.some(
              ({ payload }) =>
                payload.hook_event_name === 'subagents_update' && payload.session_id === afterId
            )
          ).toBe(true)
        }

        root.session.isStreaming = true
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'This real turn belongs to the replacement session.' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        acceptNewSnapshots = true
        fixture.harness.processEnv.ORCA_AGENT_HOOK_PORT = port
        fixture.harness.processEnv.ORCA_AGENT_HOOK_TOKEN = token
        await vi.advanceTimersByTimeAsync(1_000)

        const firstAccepted = fixture.accepted.find(
          ({ payload }) =>
            payload.hook_event_name === 'subagents_update' && payload.session_id === afterId
        )
        if (!firstAccepted) {
          throw new Error('Expected an accepted replacement-session snapshot')
        }
        expect(firstAccepted.payload).toMatchObject({
          session_id: afterId,
          session_file: afterFile,
          omp_status: {
            state: 'working',
            prompt: 'This real turn belongs to the replacement session.',
            session_boundary: true
          }
        })
        expect(childIds(firstAccepted.payload)).toEqual(['AfterUnacknowledgedChild'])

        const beforeQuietRefresh = fixture.delivered.length
        await vi.advanceTimersByTimeAsync(6_000)
        const refreshed = fixture.accepted.findLast(
          ({ payload }) =>
            payload.hook_event_name === 'subagents_update' && payload.session_id === afterId
        )
        if (!refreshed) {
          throw new Error('Expected a quiet accepted replacement-session snapshot')
        }
        expect(refreshed.observedAt).toBeGreaterThan(firstAccepted.observedAt)
        expect(refreshed.payload.omp_status).toMatchObject({ state: 'working' })
        expect(refreshed.payload.omp_status).not.toHaveProperty('session_boundary')
        expect(
          fixture.delivered
            .slice(beforeQuietRefresh)
            .filter(({ payload }) =>
              ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
            )
        ).toEqual([])
      } finally {
        acceptNewSnapshots = true
        fixture.harness.processEnv.ORCA_AGENT_HOOK_PORT = port
        fixture.harness.processEnv.ORCA_AGENT_HOOK_TOKEN = token
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it.each(['session ID replacement', 'same-ID transcript replacement'] as const)(
    'does not let a delayed old acknowledgement erase coalesced proof after %s',
    async (replacement) => {
      const root = nativeRoot('delayed-before', true)
      const beforeFile = root.file
      const afterId =
        replacement === 'same-ID transcript replacement' ? 'delayed-before' : 'delayed-after'
      const afterFile = '/sessions/delayed-after.jsonl'
      const oldChild = nativeChild('DelayedBeforeChild', beforeFile)
      const newChild = nativeChild('DelayedAfterChild', afterFile, NATIVE_TIME - 46)
      let acknowledgeOld: ((response: NativeDeliveryResponse) => void) | undefined
      const oldResponse = new Promise<NativeDeliveryResponse>((resolve) => {
        acknowledgeOld = resolve
      })
      const fixture = createNativeFixture(root, [oldChild], {
        delivery: async (payload) =>
          payload.hook_event_name === 'subagents_update' && payload.session_file === beforeFile
            ? oldResponse
            : { ok: true }
      })
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(250)
        expect(
          fixture.delivered.some(
            ({ payload }) =>
              payload.hook_event_name === 'subagents_update' && payload.session_file === beforeFile
          )
        ).toBe(true)

        root.replaceSession(afterId, undefined, afterFile)
        fixture.refs.set(newChild.id, newChild)
        await fixture.harness.callHook(
          'session_switch',
          { reason: 'new', previousSessionFile: beforeFile },
          root.context
        )
        await vi.advanceTimersByTimeAsync(250)
        // The pre-turn baseline has reached the real latest-only queue behind the old HTTP
        // request. A genuine new turn now supersedes it before any replacement ACK.
        root.session.isStreaming = true
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'Coalesced replacement work remains positively identified.' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(250)
        expect(
          fixture.accepted.filter(
            ({ payload }) =>
              payload.hook_event_name === 'subagents_update' &&
              payload.session_id === afterId &&
              payload.session_file === afterFile
          )
        ).toEqual([])

        if (!acknowledgeOld) {
          throw new Error('Expected the old native HTTP acknowledgement control')
        }
        acknowledgeOld({ ok: true })
        await vi.advanceTimersByTimeAsync(1_000)
        const firstAccepted = fixture.accepted.find(
          ({ payload }) =>
            payload.hook_event_name === 'subagents_update' &&
            payload.session_id === afterId &&
            payload.session_file === afterFile
        )
        if (!firstAccepted) {
          throw new Error('Expected an accepted replacement-session snapshot')
        }
        expect(firstAccepted.payload).toMatchObject({
          session_id: afterId,
          session_file: afterFile,
          omp_status: {
            state: 'working',
            prompt: 'Coalesced replacement work remains positively identified.',
            session_boundary: true
          }
        })
        expect(childIds(firstAccepted.payload)).toEqual(['DelayedAfterChild'])

        const beforeQuietRefresh = fixture.delivered.length
        await vi.advanceTimersByTimeAsync(6_000)
        const refreshed = fixture.accepted.findLast(
          ({ payload }) =>
            payload.hook_event_name === 'subagents_update' &&
            payload.session_id === afterId &&
            payload.session_file === afterFile
        )
        if (!refreshed) {
          throw new Error('Expected a quiet accepted replacement-session snapshot')
        }
        expect(refreshed.observedAt).toBeGreaterThan(firstAccepted.observedAt)
        expect(refreshed.payload.omp_status).not.toHaveProperty('session_boundary')
        expect(childIds(refreshed.payload)).toEqual(['DelayedAfterChild'])
        expect(
          fixture.delivered
            .slice(beforeQuietRefresh)
            .filter(({ payload }) =>
              ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
            )
        ).toEqual([])
      } finally {
        acknowledgeOld?.({ ok: true })
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it.each(['new', 'fork', 'resume'] as const)(
    'retires the old native identity and rebinds a %s on the same root manager',
    async (reason) => {
      // Native /new, fork, and resume mutate this exact SessionManager, not its identity.
      const root = nativeRoot('before-root')
      const beforeFile = root.file
      const afterFile = '/sessions/after-root.jsonl'
      const rootSession = root.session
      const context = root.context
      const oldChild = nativeChild('BeforeChild', beforeFile, 1_791_947_032_853)
      const newChild = nativeChild('AfterChild', afterFile, 1_791_947_033_853)
      const fixture = createNativeFixture(root, [oldChild])
      const { harness, refs } = fixture
      const childContext = {
        agent: { id: oldChild.id, kind: 'sub' as const, parentId: 'Main', depth: 1 },
        sessionManager: oldChild.session.sessionManager,
        isIdle: () => false
      }

      try {
        await harness.callHook('session_start', { reason: 'startup' }, context)
        rootSession.isStreaming = true
        await harness.callHook('before_agent_start', { prompt: 'Before-root-only prompt' }, context)
        await harness.callHook('agent_start', {}, context)
        await harness.callHook(
          'tool_execution_start',
          { toolName: 'bash', args: { command: 'printf transition-proof' } },
          context
        )
        await vi.advanceTimersByTimeAsync(1_000)
        const beforeUpdate = postedPayloads(harness).findLast(
          (payload) => payload.hook_event_name === 'subagents_update'
        )
        expect(childRows(beforeUpdate)).toEqual([
          expect.objectContaining({
            id: 'BeforeChild',
            name: 'BeforeChild',
            displayState: 'working'
          })
        ])

        const childFactory = harness.registerTaskChild()
        await childFactory.callHook('session_start', { reason: 'startup' }, childContext)
        await vi.advanceTimersByTimeAsync(0)
        const beforeSwitch = postedPayloads(harness).length
        const staleNotification = fixture.captureNotification()
        fixture.notify('metadata_changed', oldChild)

        // A genuine native main may have parentSession; it is not a task-child signal.
        root.replaceSession('after-root', reason === 'new' ? undefined : beforeFile)
        root.ref.status = 'idle'
        await harness.callHook(
          'session_switch',
          { reason, previousSessionFile: beforeFile },
          context
        )
        await vi.advanceTimersByTimeAsync(1_000)

        const switched = postedPayloads(harness).slice(beforeSwitch)
        const closeIndex = switched.findIndex(
          (payload) =>
            payload.hook_event_name === 'agent_end' && payload.session_id === 'before-root'
        )
        const baselineIndex = switched.findIndex(
          (payload) =>
            payload.hook_event_name === 'subagents_update' && payload.session_id === 'after-root'
        )
        expect(closeIndex).toBeGreaterThanOrEqual(0)
        expect(closeIndex).toBeLessThan(baselineIndex)
        expect(switched[closeIndex]).toMatchObject({
          session_id: 'before-root',
          session_file: beforeFile,
          session_boundary: true
        })
        const baseline = switched[baselineIndex]
        expect(baseline).toMatchObject({
          session_id: 'after-root',
          session_file: afterFile,
          omp_status: { state: 'done', session_boundary: true }
        })
        expect(baseline?.subagents ?? []).toEqual([])
        expect(baseline?.omp_status).not.toHaveProperty('prompt')
        expect(baseline?.omp_status).not.toHaveProperty('tool_name')
        expect(baseline?.omp_status).not.toHaveProperty('tool_input')

        const beforeChildShutdown = postedPayloads(harness).length
        await childFactory.callHook('session_shutdown', { reason: 'quit' }, childContext)
        await vi.advanceTimersByTimeAsync(0)
        expect(postedPayloads(harness).slice(beforeChildShutdown)).toEqual([])

        // The old child remains streaming with parentId Main, but its old transcript
        // must not enter the replacement session. Native registration adds only its new child.
        refs.set(newChild.id, newChild)
        fixture.notify('registered', newChild)
        await vi.advanceTimersByTimeAsync(1_000)
        const rebound = postedPayloads(harness).findLast(
          (payload) => payload.hook_event_name === 'subagents_update'
        )
        expect(rebound).toMatchObject({ session_id: 'after-root', session_file: afterFile })
        expect(childRows(rebound)).toEqual([
          expect.objectContaining({
            id: 'AfterChild',
            name: 'AfterChild',
            displayState: 'working',
            firstObservedAt: 1_791_947_033_853
          })
        ])

        // A child registration/shutdown cannot stop the replacement root's quiet refresh.
        const beforeRefresh = postedPayloads(harness).length
        staleNotification('metadata_changed', oldChild)
        harness.emitPiEvent('task:subagent:lifecycle', {
          id: oldChild.id,
          agent: 'registry-proof',
          status: 'started'
        })
        await vi.advanceTimersByTimeAsync(6_000)
        const refresh = postedPayloads(harness)
          .slice(beforeRefresh)
          .findLast((payload) => payload.hook_event_name === 'subagents_update')
        expect(refresh).toMatchObject({
          session_id: 'after-root',
          session_file: afterFile,
          omp_status: { state: 'done' }
        })
        expect(
          postedPayloads(harness)
            .slice(beforeRefresh)
            .filter((payload) =>
              ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
            )
        ).toEqual([])
        for (const payload of postedPayloads(harness).slice(beforeRefresh)) {
          expect(payload.session_id).toBe('after-root')
          expect(payload.omp_status?.prompt).not.toBe('Before-root-only prompt')
          expect(childIds(payload)).toEqual(['AfterChild'])
        }
        expect(childRows(refresh).map((row) => row.name)).toEqual(['AfterChild'])
      } finally {
        await harness.callHook('session_shutdown', { reason: 'quit' }, context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it('keeps deep shared inactive ancestry exact across current and foreign roots without retaining snapshot ownership', async () => {
    const root = nativeRoot('deep-ancestry-root')
    const ancestors: NativeRef[] = []
    let parentId = root.ref.id
    for (let index = 0; index < 640; index++) {
      const ancestor = nativeChild(`RetainedAncestor${index}`, root.file)
      ancestor.parentId = parentId
      ancestor.status = 'idle'
      ancestor.session.isStreaming = false
      ancestor.lifecycle = { terminalAt: NATIVE_TIME - 10 }
      ancestors.push(ancestor)
      parentId = ancestor.id
    }
    const shared = ancestors.at(-1)!
    const leaves = ['CurrentLeft', 'CurrentRight', 'CurrentThird'].map((id) => {
      const child = nativeChild(id, shared.sessionFile)
      child.parentId = shared.id
      return child
    })
    const foreignRoot = nativeRoot('foreign-ancestry-root', true)
    foreignRoot.ref.id = 'OtherMain'
    const foreignAncestor = nativeChild('ForeignAncestor', root.file)
    foreignAncestor.parentId = foreignRoot.ref.id
    foreignAncestor.status = 'idle'
    foreignAncestor.session.isStreaming = false
    const foreignLeaf = nativeChild('ForeignLeaf', root.file)
    foreignLeaf.parentId = foreignAncestor.id
    foreignLeaf.session.isStreaming = false
    foreignLeaf.session.hasPendingAsyncWork = () => {
      throw new Error('Another root cannot verify its pending work')
    }
    const oldAncestor = nativeChild('OldArtifactAncestor', '/sessions/old-ancestry-root.jsonl')
    oldAncestor.status = 'idle'
    oldAncestor.session.isStreaming = false
    const oldLeaf = nativeChild('CurrentPathUnderOldArtifact', root.file)
    oldLeaf.parentId = oldAncestor.id
    const cycleLeft = nativeChild('CycleLeft', root.file)
    const cycleRight = nativeChild('CycleRight', root.file)
    cycleLeft.parentId = cycleRight.id
    cycleRight.parentId = cycleLeft.id
    const fixture = createNativeFixture(root, [
      ...ancestors,
      ...leaves,
      foreignRoot.ref,
      foreignAncestor,
      foreignLeaf,
      oldAncestor,
      oldLeaf,
      cycleLeft,
      cycleRight
    ])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([
        'CurrentLeft',
        'CurrentRight',
        'CurrentThird'
      ])
      expect(childRows(latestSnapshot(fixture).payload)).toEqual(
        leaves.map(({ id }) => expect.objectContaining({ id, displayState: 'working' }))
      )

      const currentFile = shared.sessionFile
      const currentParent = shared.parentId
      shared.sessionFile = '/sessions/old-ancestry-root/RetainedAncestor.jsonl'
      fixture.notify('metadata_changed', shared)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([])

      shared.sessionFile = currentFile
      shared.parentId = foreignRoot.ref.id
      fixture.notify('metadata_changed', shared)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([])

      shared.parentId = currentParent
      fixture.notify('metadata_changed', shared)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([
        'CurrentLeft',
        'CurrentRight',
        'CurrentThird'
      ])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})
