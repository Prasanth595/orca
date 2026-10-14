import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AGENT_STATUS_STALE_AFTER_MS } from '../../shared/agent-status-types'
import {
  NATIVE_TIME,
  childIds,
  childRows,
  createNativeFixture,
  latestSnapshot,
  nativeChild,
  nativeRoot,
  postedPayloads,
  type NativeRef
} from './agent-status-extension-omp-registry-fixture'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

describe('OMP native registry uncertainty and attachment', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('preserves the last verified roster and lets its evidence age when native list fails', async () => {
    const root = nativeRoot('unavailable-root', true)
    const child = nativeChild('LastVerifiedChild', root.file)
    const fixture = createNativeFixture(root, [child])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const verified = latestSnapshot(fixture)
      const beforeFailure = fixture.delivered.length

      fixture.failList(new Error('Native registry is temporarily unreadable'))
      fixture.setStatus(child, 'idle')
      await vi.advanceTimersByTimeAsync(12_000)

      expect(fixture.delivered.slice(beforeFailure)).toEqual([])
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['LastVerifiedChild'])
      expect(latestSnapshot(fixture).observedAt).toBe(verified.observedAt)
      vi.setSystemTime(verified.observedAt + AGENT_STATUS_STALE_AFTER_MS + 1)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(fixture.delivered.slice(beforeFailure)).toEqual([])
      expect(childRows(verified.payload, verified.observedAt)).toEqual([
        expect.objectContaining({
          id: 'LastVerifiedChild',
          name: 'LastVerifiedChild',
          displayState: 'unverifiable',
          detail: { kind: 'no-update' },
          recencyAt: verified.observedAt
        })
      ])

      // No lifecycle replay repairs the roster. The next successful native read
      // positively verifies empty membership and may finally complete the root.
      fixture.failList()
      await vi.advanceTimersByTimeAsync(6_000)
      const recovered = latestSnapshot(fixture)
      expect(recovered.observedAt).toBeGreaterThan(verified.observedAt)
      expect(recovered.payload).toMatchObject({
        session_id: 'unavailable-root',
        session_file: root.file,
        omp_status: { state: 'done' }
      })
      expect(childIds(recovered.payload)).toEqual([])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toHaveLength(1)
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('cannot renew child evidence through a queued HTTP retry after native enumeration fails', async () => {
    const root = nativeRoot('retry-proof-root', true)
    const first = nativeChild('PreviouslyAcceptedChild', root.file)
    const second = nativeChild('NotYetAcceptedChild', root.file, NATIVE_TIME - 46)
    let acceptSnapshots = true
    const fixture = createNativeFixture(root, [first], {
      delivery: async (payload) =>
        payload.hook_event_name === 'subagents_update' && !acceptSnapshots
          ? { ok: false, status: 503 }
          : { ok: true }
    })
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const verified = fixture.accepted.findLast(
        ({ payload }) => payload.hook_event_name === 'subagents_update'
      )
      if (!verified) {
        throw new Error('Expected the receiver to accept the initial native roster')
      }
      expect(childIds(verified.payload)).toEqual(['PreviouslyAcceptedChild'])

      acceptSnapshots = false
      const beforeFailedUpdate = fixture.delivered.length
      fixture.refs.set(second.id, second)
      fixture.notify('registered', second)
      await vi.advanceTimersByTimeAsync(250)
      const failedUpdate = fixture.delivered
        .slice(beforeFailedUpdate)
        .find(({ payload }) => payload.hook_event_name === 'subagents_update')
      if (!failedUpdate) {
        throw new Error('Expected a failed native roster delivery')
      }
      expect(childIds(failedUpdate.payload)).toEqual([
        'NotYetAcceptedChild',
        'PreviouslyAcceptedChild'
      ])

      // Keep HTTP offline until the observer has encountered the registry failure.
      // A queued delivery can no longer claim its retained working map is new evidence.
      fixture.failList(new Error('Native registry cannot verify child activity'))
      fixture.notify('metadata_changed', second)
      await vi.advanceTimersByTimeAsync(250)
      const beforeEndpointRecovery = fixture.accepted.length
      acceptSnapshots = true
      await vi.advanceTimersByTimeAsync(2_000)
      expect(
        fixture.accepted
          .slice(beforeEndpointRecovery)
          .filter(({ payload }) => payload.hook_event_name === 'subagents_update')
      ).toEqual([])

      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'read', args: { path: 'src/registry-retry-fixture.ts' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fixture.accepted.slice(beforeEndpointRecovery)).toEqual([])

      vi.setSystemTime(verified.observedAt + AGENT_STATUS_STALE_AFTER_MS + 1)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(fixture.accepted.slice(beforeEndpointRecovery)).toEqual([])
      expect(childRows(verified.payload, verified.observedAt)).toEqual([
        expect.objectContaining({
          id: 'PreviouslyAcceptedChild',
          name: 'PreviouslyAcceptedChild',
          displayState: 'unverifiable',
          detail: { kind: 'no-update' },
          recencyAt: verified.observedAt
        })
      ])

      fixture.failList()
      await vi.advanceTimersByTimeAsync(6_000)
      const recovered = fixture.accepted.findLast(
        ({ payload }) => payload.hook_event_name === 'subagents_update'
      )
      if (!recovered) {
        throw new Error('Expected an accepted verified recovery snapshot')
      }
      expect(recovered.observedAt).toBeGreaterThan(verified.observedAt)
      expect(recovered.payload).toMatchObject({
        session_id: 'retry-proof-root',
        session_file: root.file,
        omp_status: {
          state: 'working',
          tool_name: 'read',
          tool_input: { path: 'src/registry-retry-fixture.ts' }
        }
      })
      expect(childIds(recovered.payload)).toEqual([
        'NotYetAcceptedChild',
        'PreviouslyAcceptedChild'
      ])
      expect(childRows(recovered.payload, recovered.observedAt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'PreviouslyAcceptedChild', displayState: 'working' }),
          expect.objectContaining({ id: 'NotYetAcceptedChild', displayState: 'working' })
        ])
      )
      expect(
        fixture.accepted
          .slice(beforeEndpointRecovery)
          .filter(({ payload }) =>
            ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
          )
      ).toEqual([])
    } finally {
      acceptSnapshots = true
      fixture.failList()
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('does not treat a retained genuine completion as an explicit closing boundary during read failure', async () => {
    const root = nativeRoot('retained-completion-root', true)
    const child = nativeChild('HeldCompletionChild', root.file)
    let acceptStatus = true
    const fixture = createNativeFixture(root, [child], {
      delivery: async (payload) =>
        ['agent_end', 'subagents_update'].includes(payload.hook_event_name) && !acceptStatus
          ? { ok: false, status: 503 }
          : { ok: true }
    })
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const verified = fixture.accepted.findLast(
        ({ payload }) => payload.hook_event_name === 'subagents_update'
      )
      if (!verified) {
        throw new Error('Expected an accepted roster holding parent completion')
      }
      expect(childIds(verified.payload)).toEqual(['HeldCompletionChild'])

      acceptStatus = false
      const beforeCompletionAttempt = fixture.delivered.length
      const beforeFailure = fixture.accepted.length
      fixture.setStatus(child, 'idle')
      await vi.advanceTimersByTimeAsync(250)
      const completionAttempt = fixture.delivered
        .slice(beforeCompletionAttempt)
        .find(({ payload }) => payload.hook_event_name === 'agent_end')
      if (!completionAttempt) {
        throw new Error('Expected a genuine terminal completion attempt')
      }
      expect(completionAttempt.payload).not.toHaveProperty('session_boundary')

      // The native final snapshot retains that failed completion in the real queue.
      // It is still a turn completion, not a closing-session exception to the read fence.
      fixture.failList(new Error('Native terminal membership is temporarily unreadable'))
      fixture.notify('metadata_changed', child)
      await vi.advanceTimersByTimeAsync(250)
      acceptStatus = true
      await vi.advanceTimersByTimeAsync(1_500)
      expect(fixture.accepted.slice(beforeFailure)).toEqual([])
      expect(childIds(verified.payload)).toEqual(['HeldCompletionChild'])

      fixture.failList()
      fixture.notify('metadata_changed', child)
      await vi.advanceTimersByTimeAsync(1_000)
      const recovered = fixture.accepted.findLast(
        ({ payload }) => payload.hook_event_name === 'subagents_update'
      )
      if (!recovered) {
        throw new Error('Expected verified native terminal membership recovery')
      }
      expect(recovered.observedAt).toBeGreaterThan(verified.observedAt)
      expect(recovered.payload).toMatchObject({
        session_id: 'retained-completion-root',
        session_file: root.file,
        omp_status: { state: 'done' }
      })
      expect(childIds(recovered.payload)).toEqual([])
    } finally {
      acceptStatus = true
      fixture.failList()
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('does not clear or complete while a registered native replacement child is still attaching', async () => {
    const root = nativeRoot('attaching-root', true)
    const first = nativeChild('AttachedChild', root.file)
    const pending: NativeRef = nativeChild('AttachingChild', root.file, NATIVE_TIME - 46)
    const attachedSession = pending.session
    pending.session = null
    const fixture = createNativeFixture(root, [first])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)

      fixture.refs.set(pending.id, pending)
      fixture.notify('registered', pending)
      fixture.setStatus(first, 'idle')
      await vi.advanceTimersByTimeAsync(6_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['AttachedChild'])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])

      pending.session = attachedSession
      fixture.notify('metadata_changed', pending)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['AttachingChild'])
      expect(childRows(latestSnapshot(fixture).payload)).toEqual([
        expect.objectContaining({ id: 'AttachingChild', displayState: 'working' })
      ])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])

      fixture.setStatus(pending, 'aborted')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toHaveLength(1)
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})
