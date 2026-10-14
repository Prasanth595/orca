import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import {
  AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH,
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusIpcPayload
} from '../../shared/agent-status-types'
import { AgentHookServer } from '../agent-hooks/server'
import { PANE, type Body } from '../agent-hooks/server.test-fixtures'
import {
  NATIVE_TIME,
  childIds,
  childRows,
  createNativeFixture,
  latestSnapshot,
  nativeChild,
  nativeRoot,
  postedPayloads,
  type NativeRef,
  type NativeRoot
} from './agent-status-extension-omp-registry-fixture'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

function createNativeConsumer(root: NativeRoot, children: NativeRef[] = []) {
  const server = new AgentHookServer()
  const fixture = createNativeFixture(root, children, {
    env: {
      ORCA_AGENT_HOOK_ENV: 'production',
      ORCA_PANE_KEY: PANE,
      ORCA_TAB_ID: 'tab-1',
      ORCA_WORKTREE_ID: 'wt-1',
      ORCA_AGENT_LAUNCH_TOKEN: undefined
    }
  })
  let consumedRequests = 0
  return {
    fixture,
    server,
    consume(): AgentStatusIpcPayload {
      const requests = fixture.harness.fetchMock.mock.calls.slice(consumedRequests)
      for (const request of requests) {
        const body: Body = JSON.parse(String(request[1]?.body))
        const event = normalizeHookPayload(server._getStateForTests(), 'omp', body, 'production')
        if (event) {
          server.ingestRemote(event, null)
        }
      }
      consumedRequests += requests.length
      const row = server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
      if (!row) {
        throw new Error('Expected an admitted native OMP consumer row')
      }
      return row
    }
  }
}

describe('OMP native registry execution evidence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('retains a child through idle async work and resumed streaming until native terminal settlement', async () => {
    const root = nativeRoot('async-child-root', true)
    const child = nativeChild('BackgroundChild', root.file)
    let pendingAsyncWork = false
    child.session.hasPendingAsyncWork = () => pendingAsyncWork
    const { fixture, consume, server } = createNativeConsumer(root, [child])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook(
        'before_agent_start',
        { prompt: 'Wait for the native background child.' },
        root.context
      )
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume()).toMatchObject({ state: 'working' })

      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })

      // Native intermediate agent_end sets idle while task executor awaits quiescence.
      pendingAsyncWork = true
      fixture.setStatus(child, 'idle')
      expect(child.lifecycle?.terminalAt).toBe(Date.now())
      await vi.advanceTimersByTimeAsync(1_000)
      const awaiting = latestSnapshot(fixture)
      expect(childIds(awaiting.payload)).toEqual(['BackgroundChild'])
      expect(childRows(awaiting.payload, awaiting.observedAt)).toEqual([
        expect.objectContaining({ id: 'BackgroundChild', displayState: 'working' })
      ])
      expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])

      await vi.advanceTimersByTimeAsync(6_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['BackgroundChild'])
      expect(consume()).toMatchObject({ state: 'working' })

      pendingAsyncWork = false
      child.session.isStreaming = true
      fixture.setStatus(child, 'running')
      expect(child.lifecycle).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['BackgroundChild'])
      expect(consume()).toMatchObject({ state: 'working' })

      fixture.setStatus(child, 'idle')
      child.lifecycle = { ...child.lifecycle, acceptedAt: Date.now() }
      fixture.notify('metadata_changed', child)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([])
      expect(consume()).toMatchObject({ state: 'done' })
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toHaveLength(1)
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it('keeps untouched native-running initialization and a new no-prompt session connected-idle', async () => {
    const root = nativeRoot('unprompted-root')
    root.session.hasPendingAsyncWork = () => false
    const { fixture, consume, server } = createNativeConsumer(root)
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const initial = consume()
      expect(initial).toMatchObject({
        state: 'done',
        sessionBoundary: true,
        prompt: '',
        mainAgent: { state: 'done' }
      })
      expect(initial.turnStartedAt).toBeUndefined()
      expect(root.ref.status).toBe('running')
      expect(latestSnapshot(fixture).payload.omp_status).toEqual({
        state: 'done',
        session_boundary: true
      })
      const beforeQuiet = fixture.delivered.length
      await vi.advanceTimersByTimeAsync(12_000)
      expect(fixture.delivered.slice(beforeQuiet)).toEqual([])

      const beforeFile = root.file
      root.replaceSession('new-unprompted-root')
      await fixture.harness.callHook(
        'session_switch',
        { reason: 'new', previousSessionFile: beforeFile },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume()).toMatchObject({
        providerSession: { id: 'new-unprompted-root', transcriptPath: root.file },
        state: 'done',
        sessionBoundary: true,
        prompt: '',
        mainAgent: { state: 'done' }
      })
      expect(consume().turnStartedAt).toBeUndefined()
      expect(latestSnapshot(fixture).payload).toMatchObject({
        session_id: 'new-unprompted-root',
        session_file: root.file,
        omp_status: { state: 'done', session_boundary: true },
        subagents: []
      })
      expect(
        postedPayloads(fixture.harness).filter(
          (payload) =>
            payload.hook_event_name === 'before_agent_start' ||
            payload.hook_event_name === 'agent_start' ||
            (payload.hook_event_name === 'agent_end' &&
              payload.session_id === 'new-unprompted-root')
        )
      ).toEqual([])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it.each(['streaming', 'pending async work'] as const)(
    'seeds a working root from positive native %s even when its registry status is idle',
    async (evidence) => {
      const root = nativeRoot('positive-root', evidence === 'streaming')
      root.ref.status = 'idle'
      root.session.hasPendingAsyncWork = () => evidence === 'pending async work'
      const { fixture, consume, server } = createNativeConsumer(root)
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(latestSnapshot(fixture).payload.omp_status).toEqual({
          state: 'working',
          session_boundary: true
        })
        expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'working' } })
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        server.stop()
      }
    }
  )

  it('retains native approval reason through same-tool execution, quiet refresh and same-scope rebind', async () => {
    const root = nativeRoot('approval-reason-root', true)
    const { fixture, consume, server } = createNativeConsumer(root)
    const reason = 'Allow the local fixture command to inspect the selected workspace?'
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook(
        'before_agent_start',
        { prompt: 'Inspect the selected workspace.' },
        root.context
      )
      await fixture.harness.callHook('agent_start', {}, root.context)
      await fixture.harness.callHook(
        'tool_approval_requested',
        { toolName: 'bash', reason, approvalMode: 'execute' },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      const blocked = consume()
      expect(blocked).toMatchObject({ state: 'blocked', toolName: 'bash', toolInput: reason })

      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'bash', args: { command: 'printf native-approval-fixture' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(6_000)
      expect(consume()).toMatchObject({
        state: 'blocked',
        stateStartedAt: blocked.stateStartedAt,
        turnStartedAt: blocked.turnStartedAt,
        toolName: 'bash',
        toolInput: reason
      })
      expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({
        state: 'blocked',
        tool_name: 'bash',
        tool_input: reason
      })
      fixture.harness.reload()
      await fixture.harness.callHook('session_start', { reason: 'reload' }, root.context)
      await vi.advanceTimersByTimeAsync(6_000)
      expect(consume()).toMatchObject({
        state: 'blocked',
        prompt: 'Inspect the selected workspace.',
        stateStartedAt: blocked.stateStartedAt,
        turnStartedAt: blocked.turnStartedAt,
        toolName: 'bash',
        toolInput: reason
      })

      await fixture.harness.callHook(
        'tool_approval_resolved',
        { toolName: 'bash', approved: true },
        root.context
      )
      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'bash', args: { command: 'printf native-approval-fixture' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume()).toMatchObject({
        state: 'working',
        toolInput: 'printf native-approval-fixture'
      })
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it('keeps the entire native active set behind the 32-row payload cap until the hidden last child finishes', async () => {
    const root = nativeRoot('overflow-root', true)
    const children = Array.from({ length: 40 }, (_, index) =>
      nativeChild(`OverflowChild${index}`, root.file, NATIVE_TIME - 100 + index)
    )
    const { fixture, consume, server } = createNativeConsumer(root, children)
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const shown = childIds(latestSnapshot(fixture).payload)
      expect(shown).toHaveLength(32)
      const hidden = children.find(({ id }) => !shown.includes(id))!
      expect(consume().subagents).toHaveLength(32)

      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      for (const child of children) {
        if (child === hidden) {
          continue
        }
        child.lifecycle = { terminalAt: Date.now() }
        fixture.setStatus(child, 'idle')
      }
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([hidden.id])
      expect(consume()).toMatchObject({
        state: 'working',
        mainAgent: { state: 'done' },
        subagents: [expect.objectContaining({ id: hidden.id, state: 'working' })]
      })
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])

      hidden.lifecycle = { terminalAt: Date.now() }
      fixture.setStatus(hidden, 'idle')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(consume()).toMatchObject({ state: 'done' })
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toHaveLength(1)
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it('excludes parked, advisor and aborted refs despite stale work fields, and settled historical refs', async () => {
    const root = nativeRoot('terminal-history-root')
    const live = nativeChild('LivePendingChild', root.file)
    live.status = 'idle'
    live.session.isStreaming = false
    live.session.hasPendingAsyncWork = () => true
    const retained = ['Parked', 'Advisor', 'Aborted', 'Terminal'].map((id) => {
      const ref = nativeChild(id, root.file)
      ref.session.hasPendingAsyncWork = () => true
      return ref
    })
    retained[0]!.status = 'parked'
    retained[1]!.kind = 'advisor'
    retained[2]!.status = 'aborted'
    retained[3]!.session.isStreaming = false
    retained[3]!.session.hasPendingAsyncWork = () => false
    retained[3]!.lifecycle = { acceptedAt: NATIVE_TIME - 1, terminalAt: NATIVE_TIME - 1 }
    const { fixture, consume, server } = createNativeConsumer(root, [live, ...retained])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['LivePendingChild'])
      expect(consume()).toMatchObject({
        state: 'working',
        mainAgent: { state: 'done' },
        subagents: [expect.objectContaining({ id: 'LivePendingChild', state: 'working' })]
      })
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it.each(['root', 'child'] as const)(
    'keeps failed native %s async-work reads unverifiable rather than publishing fresh empty membership',
    async (failureTarget) => {
      const root = nativeRoot('native-read-error-root', true)
      const child = nativeChild('UnverifiableChild', root.file)
      const { fixture, consume, server } = createNativeConsumer(root, [child])
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        root.session.isStreaming = false
        await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        consume()
        const verified = latestSnapshot(fixture)
        const beforeFailure = fixture.delivered.length
        const unreadableSession = failureTarget === 'root' ? root.session : child.session
        unreadableSession.hasPendingAsyncWork = () => {
          throw new Error('Native async work state is temporarily unavailable')
        }
        fixture.setStatus(child, 'idle')
        await vi.advanceTimersByTimeAsync(12_000)
        expect(fixture.delivered.slice(beforeFailure)).toEqual([])
        expect(latestSnapshot(fixture).observedAt).toBe(verified.observedAt)
        vi.setSystemTime(verified.observedAt + AGENT_STATUS_STALE_AFTER_MS + 1)
        expect(childRows(verified.payload, verified.observedAt)).toEqual([
          expect.objectContaining({ id: 'UnverifiableChild', displayState: 'unverifiable' })
        ])

        root.session.hasPendingAsyncWork = () => false
        child.session.hasPendingAsyncWork = () => true
        // Recovery is also native-silent; no metadata event repairs the failed read.
        await vi.advanceTimersByTimeAsync(6_000)
        expect(childIds(latestSnapshot(fixture).payload)).toEqual(['UnverifiableChild'])
        expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })
        expect(
          postedPayloads(fixture.harness).filter(
            (payload) => payload.hook_event_name === 'agent_end'
          )
        ).toEqual([])

        child.session.hasPendingAsyncWork = () => false
        child.lifecycle = { ...child.lifecycle, acceptedAt: Date.now() }
        fixture.notify('metadata_changed', child)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(consume()).toMatchObject({ state: 'done' })
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        server.stop()
      }
    }
  )

  it('keeps an active native ask ahead of approval details and unrelated root tool traffic', async () => {
    const root = nativeRoot('ask-before-approval-root', true)
    root.context.hasUI = true
    const { fixture, consume, server } = createNativeConsumer(root)
    const questions = {
      questions: [
        {
          id: 'continue-fixture',
          question: 'Continue the local fixture?',
          options: [{ label: 'Yes' }]
        }
      ]
    }
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'ask', args: questions },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      const blocked = consume()
      await fixture.harness.callHook(
        'tool_approval_requested',
        { toolName: 'bash', reason: 'Allow a parallel local command?' },
        root.context
      )
      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'bash', args: { command: 'printf parallel-fixture' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(6_000)
      const refreshed = consume()
      expect(refreshed).toMatchObject({
        state: 'blocked',
        toolName: 'ask',
        interactivePrompt: JSON.stringify(questions),
        stateStartedAt: blocked.stateStartedAt
      })
      expect(refreshed.turnStartedAt).toBe(blocked.turnStartedAt)
      expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({
        state: 'blocked',
        tool_name: 'ask',
        tool_input: questions
      })
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it('bounds approval reasons and sanitizes their full text before truncation', async () => {
    const root = nativeRoot('bounded-approval-root', true)
    const { fixture, server } = createNativeConsumer(root)
    const oversizedReason = 'r'.repeat(AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH + 20)
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook(
        'tool_approval_requested',
        { toolName: 'bash', reason: oversizedReason },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(latestSnapshot(fixture).payload.omp_status?.tool_input).toBe(
        oversizedReason.slice(0, AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH)
      )
      await fixture.harness.callHook(
        'tool_approval_requested',
        { toolName: 'bash', reason: `${oversizedReason}/home/test/.ssh/id_rsa` },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect(latestSnapshot(fixture).payload.omp_status).not.toHaveProperty('tool_input')
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it.each(['before the question', 'during the question'] as const)(
    'restores an unresolved native approval requested %s after the ask ends across same-scope rebind',
    async (approvalOrder) => {
      const root = nativeRoot('overlapping-input-root', true)
      root.context.hasUI = true
      const { fixture, consume, server } = createNativeConsumer(root)
      const reason = 'Allow the local inspection command after the question is answered?'
      const questions = {
        questions: [
          {
            id: 'inspection-scope',
            question: 'Which fixture scope should be inspected?',
            header: 'Scope',
            options: [{ label: 'Selected workspace' }]
          }
        ]
      }
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook(
          'before_agent_start',
          { prompt: 'Inspect the selected fixture scope.' },
          root.context
        )
        await fixture.harness.callHook('agent_start', {}, root.context)
        if (approvalOrder === 'before the question') {
          await fixture.harness.callHook(
            'tool_approval_requested',
            { toolName: 'bash', reason },
            root.context
          )
        }
        await fixture.harness.callHook(
          'tool_execution_start',
          { toolName: 'ask', args: questions },
          root.context
        )
        if (approvalOrder === 'during the question') {
          await fixture.harness.callHook(
            'tool_approval_requested',
            { toolName: 'bash', reason },
            root.context
          )
        }
        await vi.advanceTimersByTimeAsync(1_000)
        const asking = consume()
        expect(asking).toMatchObject({
          state: 'blocked',
          toolName: 'ask',
          interactivePrompt: JSON.stringify(questions)
        })

        fixture.harness.reload()
        await fixture.harness.callHook('session_start', { reason: 'reload' }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(consume()).toMatchObject({
          state: 'blocked',
          toolName: 'ask',
          interactivePrompt: JSON.stringify(questions),
          turnStartedAt: asking.turnStartedAt
        })

        await fixture.harness.callHook('tool_execution_end', { toolName: 'ask' }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({
          state: 'blocked',
          input_pending: true,
          tool_name: 'bash',
          tool_input: reason
        })
        const approval = consume()
        expect(approval).toMatchObject({
          state: 'blocked',
          toolName: 'bash',
          toolInput: reason,
          turnStartedAt: asking.turnStartedAt
        })
        expect(approval.interactivePrompt).toBeUndefined()

        await fixture.harness.callHook(
          'tool_approval_resolved',
          { toolName: 'bash', approved: true },
          root.context
        )
        await vi.advanceTimersByTimeAsync(1_000)
        expect(consume()).toMatchObject({ state: 'working', toolName: 'bash' })
        await fixture.harness.callHook(
          'tool_execution_start',
          { toolName: 'ask', args: questions },
          root.context
        )
        await fixture.harness.callHook('tool_execution_end', { toolName: 'ask' }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({
          state: 'working',
          input_pending: false
        })
        expect(latestSnapshot(fixture).payload.omp_status).not.toHaveProperty('tool_input')
        expect(consume()).toMatchObject({ state: 'working' })
        expect(consume().interactivePrompt).toBeUndefined()
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        server.stop()
      }
    }
  )

  it.each(['untouched', 'turn started', 'approval pending', 'question pending'] as const)(
    'recovers an initially unavailable native root baseline while preserving %s facts',
    async (capturedFact) => {
      const root = nativeRoot('initially-unavailable-root')
      root.context.hasUI = true
      let readFails = true
      root.session.hasPendingAsyncWork = () => {
        if (readFails) {
          throw new Error('Native root work state is not ready')
        }
        return true
      }
      const { fixture, consume, server } = createNativeConsumer(root)
      const reason = 'Allow the local recovery fixture?'
      const questions = {
        questions: [
          {
            id: 'recovered-scope',
            question: 'Which local scope should recover?',
            header: 'Scope',
            options: [{ label: 'Selected workspace' }]
          }
        ]
      }
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await vi.advanceTimersByTimeAsync(6_000)
        expect(fixture.delivered).toEqual([])
        if (capturedFact === 'turn started') {
          await fixture.harness.callHook(
            'before_agent_start',
            { prompt: 'Recover this genuine native turn.' },
            root.context
          )
        } else if (capturedFact === 'approval pending') {
          await fixture.harness.callHook(
            'tool_approval_requested',
            { toolName: 'bash', reason },
            root.context
          )
        } else if (capturedFact === 'question pending') {
          await fixture.harness.callHook(
            'tool_execution_start',
            { toolName: 'ask', args: questions },
            root.context
          )
        }
        await vi.advanceTimersByTimeAsync(1_000)
        expect(
          fixture.delivered.filter(({ payload }) => payload.hook_event_name === 'subagents_update')
        ).toEqual([])

        // The next managed refresh, not a synthetic turn or metadata callback, recovers.
        readFails = false
        await vi.advanceTimersByTimeAsync(6_000)
        const recovered = consume()
        const rootStatus = latestSnapshot(fixture).payload.omp_status
        if (capturedFact === 'untouched') {
          expect(rootStatus).toEqual({ state: 'working', session_boundary: true })
          expect(recovered).toMatchObject({ state: 'working', mainAgent: { state: 'working' } })
          expect(
            postedPayloads(fixture.harness).filter((payload) =>
              ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
            )
          ).toEqual([])
        } else if (capturedFact === 'turn started') {
          expect(rootStatus).toMatchObject({
            state: 'working',
            prompt: 'Recover this genuine native turn.'
          })
          expect(recovered).toMatchObject({
            state: 'working',
            prompt: 'Recover this genuine native turn.'
          })
        } else if (capturedFact === 'approval pending') {
          expect(rootStatus).toMatchObject({
            state: 'blocked',
            input_pending: true,
            tool_name: 'bash',
            tool_input: reason
          })
          expect(recovered).toMatchObject({ state: 'blocked', toolName: 'bash', toolInput: reason })
        } else {
          expect(rootStatus).toMatchObject({
            state: 'blocked',
            input_pending: true,
            tool_name: 'ask',
            tool_input: questions
          })
          expect(recovered).toMatchObject({
            state: 'blocked',
            toolName: 'ask',
            interactivePrompt: JSON.stringify(questions)
          })
        }
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
        server.stop()
      }
    }
  )
})
