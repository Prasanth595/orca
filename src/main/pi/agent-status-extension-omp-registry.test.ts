import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseAskFromStatus } from '../../shared/native-chat-ask'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusIpcPayload
} from '../../shared/agent-status-types'
import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { AgentHookServer } from '../agent-hooks/server'
import { PANE, type Body } from '../agent-hooks/server.test-fixtures'
import {
  NATIVE_TIME,
  childIds,
  childRows,
  createNativeFixture,
  latestPost,
  latestSnapshot,
  nativeChild,
  nativeRoot,
  postedPayloads,
  type NativeRef
} from './agent-status-extension-omp-registry-fixture'
import type { HookContext } from './agent-status-extension-test-harness'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const OMP_RUNTIME_CASES = [
  ['configured OMP', { kind: 'omp' as const }],
  ['title-routed OMP', { kind: 'pi' as const, title: 'omp' }],
  ['argv-routed OMP', { kind: 'pi' as const, argv: ['node', '/usr/local/bin/omp'] }]
] as const

describe('OMP native registry roster', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NATIVE_TIME)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each(OMP_RUNTIME_CASES)(
    'bootstraps already-running named children for %s without lifecycle starts',
    async (_name, runtime) => {
      // The native probe captured a running, non-streaming main and streaming task children.
      const root = nativeRoot()
      const fixture = createNativeFixture(
        root,
        [
          nativeChild('RegistryProofChild', root.file),
          nativeChild('RegistryProofSibling', root.file, NATIVE_TIME - 46)
        ],
        { runtime }
      )

      try {
        // No lifecycle or registry start event is replayed to help reconstruct them.
        await fixture.harness.callHook(
          'session_start',
          { type: 'session_start', reason: 'startup' },
          root.context
        )
        await vi.advanceTimersByTimeAsync(1_000)

        const update = latestSnapshot(fixture)
        expect(update.payload).toMatchObject({
          hook_event_name: 'subagents_update',
          session_id: 'root-session',
          session_file: root.file,
          omp_status: { state: 'done', session_boundary: true }
        })
        expect(childIds(update.payload)).toEqual(['RegistryProofChild', 'RegistryProofSibling'])
        expect(update.payload.subagents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'RegistryProofChild',
              agentType: 'registry-proof',
              state: 'working',
              startedAt: NATIVE_TIME - 47
            }),
            expect.objectContaining({
              id: 'RegistryProofSibling',
              agentType: 'registry-proof',
              state: 'working',
              startedAt: NATIVE_TIME - 46
            })
          ])
        )
        expect(childRows(update.payload, update.observedAt)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'RegistryProofChild',
              name: 'RegistryProofChild',
              agentType: 'registry-proof',
              detail: { kind: 'role', agentType: 'registry-proof' },
              displayState: 'working',
              firstObservedAt: NATIVE_TIME - 47
            }),
            expect.objectContaining({
              id: 'RegistryProofSibling',
              name: 'RegistryProofSibling',
              agentType: 'registry-proof',
              detail: { kind: 'role', agentType: 'registry-proof' },
              displayState: 'working',
              firstObservedAt: NATIVE_TIME - 46
            })
          ])
        )
        expect(
          fixture.delivered.filter(({ payload }) =>
            ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
          )
        ).toEqual([])
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it.each(['approval resolution', 'new root turn'] as const)(
    'keeps native approval blocked through tool starts and rebind until %s',
    async (release) => {
      const root = nativeRoot('approval-root', true)
      const child = nativeChild('ApprovalChild', root.file)
      const fixture = createNativeFixture(root, [child])
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        await fixture.harness.callHook('agent_start', {}, root.context)
        await fixture.harness.callHook(
          'tool_approval_requested',
          { toolName: 'bash', reason: 'Local permission fixture', approvalMode: 'execute' },
          root.context
        )
        await fixture.harness.callHook(
          'tool_execution_start',
          { toolName: 'bash', args: { command: 'printf approval-fixture' } },
          root.context
        )
        await vi.advanceTimersByTimeAsync(1_000)

        expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({
          state: 'blocked',
          tool_name: 'bash'
        })
        expect(childIds(latestSnapshot(fixture).payload)).toEqual(['ApprovalChild'])
        const beforeRebind = fixture.delivered.length
        fixture.harness.reload()
        await fixture.harness.callHook('session_start', { reason: 'reload' }, root.context)
        await vi.advanceTimersByTimeAsync(6_000)

        // Native isRunning/streaming and a rebound observer are not approval resolution.
        expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({ state: 'blocked' })
        expect(childIds(latestSnapshot(fixture).payload)).toEqual(['ApprovalChild'])
        expect(
          fixture.delivered
            .slice(beforeRebind)
            .filter(({ payload }) =>
              ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
            )
        ).toEqual([])

        if (release === 'approval resolution') {
          await fixture.harness.callHook(
            'tool_approval_resolved',
            { toolName: 'bash', approved: true },
            root.context
          )
        } else {
          await fixture.harness.callHook(
            'before_agent_start',
            { prompt: 'A genuine new root turn supersedes the old approval.' },
            root.context
          )
          await fixture.harness.callHook('agent_start', {}, root.context)
        }
        await vi.advanceTimersByTimeAsync(1_000)
        expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({ state: 'working' })
        expect(childIds(latestSnapshot(fixture).payload)).toEqual(['ApprovalChild'])
        expect(
          postedPayloads(fixture.harness).filter(
            (payload) => payload.hook_event_name === 'agent_end'
          )
        ).toEqual([])
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it('keeps native ask input and blocked wait clocks through heartbeat and unrelated child tools', async () => {
    const server = new AgentHookServer()
    const root = nativeRoot('question-root', true)
    root.context.hasUI = true
    const child = nativeChild('QuestionChild', root.file)
    const fixture = createNativeFixture(root, [child], {
      env: {
        ORCA_AGENT_HOOK_ENV: 'production',
        ORCA_PANE_KEY: PANE,
        ORCA_TAB_ID: 'tab-1',
        ORCA_WORKTREE_ID: 'wt-1',
        ORCA_AGENT_LAUNCH_TOKEN: undefined
      }
    })
    let consumedRequests = 0
    const consumePostedRequests = (): AgentStatusIpcPayload => {
      // Use the existing synchronous normalization/admission/timing path, not
      // socket startup or unrelated native profile discovery under fake timers.
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
    const questions = {
      questions: [
        {
          id: 'fixture-next-step',
          question: 'Continue with the local fixture?',
          header: 'Next step',
          options: [{ label: 'Continue' }, { label: 'Pause' }]
        }
      ]
    }
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      consumePostedRequests()
      await fixture.harness.callHook(
        'before_agent_start',
        { prompt: 'Request a local decision.' },
        root.context
      )
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(500)
      consumePostedRequests()
      await vi.advanceTimersByTimeAsync(250)
      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'ask', args: questions },
        root.context
      )
      await vi.advanceTimersByTimeAsync(0)

      const blocked = consumePostedRequests()
      expect(blocked).toMatchObject({
        state: 'blocked',
        prompt: 'Request a local decision.',
        toolName: 'ask'
      })
      expect(blocked.turnStartedAt).toBeDefined()
      if (typeof blocked.stateStartedAt !== 'number' || typeof blocked.turnStartedAt !== 'number') {
        throw new Error('Expected published native ask wait and turn clocks')
      }
      expect(blocked.interactivePrompt).toBe(JSON.stringify(questions))
      const question = parseAskFromStatus(blocked.interactivePrompt, blocked.toolName)
      expect(question).toMatchObject({
        questions: [
          {
            question: 'Continue with the local fixture?',
            header: 'Next step',
            options: [{ label: 'Continue' }, { label: 'Pause' }]
          }
        ]
      })

      await vi.advanceTimersByTimeAsync(6_000)
      const heartbeat = consumePostedRequests()
      expect(heartbeat.receivedAt).toBeGreaterThan(blocked.receivedAt)
      expect(heartbeat).toMatchObject({
        state: 'blocked',
        stateStartedAt: blocked.stateStartedAt,
        turnStartedAt: blocked.turnStartedAt,
        mainAgent: { state: 'blocked', stateStartedAt: blocked.stateStartedAt }
      })
      expect(heartbeat.interactivePrompt).toBe(blocked.interactivePrompt)
      expect(parseAskFromStatus(heartbeat.interactivePrompt, heartbeat.toolName)).toEqual(question)

      const childFactory = fixture.harness.registerTaskChild()
      const childContext: HookContext = {
        agent: { id: child.id, kind: 'sub', parentId: 'Main', depth: 1 },
        sessionManager: child.session.sessionManager,
        isIdle: () => false
      }
      await childFactory.callHook('session_start', { reason: 'startup' }, childContext)
      await childFactory.callHook(
        'tool_execution_start',
        { toolName: 'read', args: { path: 'src/question-fixture.ts' } },
        childContext
      )
      await childFactory.callHook('tool_execution_end', { toolName: 'read' }, childContext)
      await vi.advanceTimersByTimeAsync(6_000)
      const afterChildTools = consumePostedRequests()
      expect(afterChildTools).toMatchObject({
        state: 'blocked',
        stateStartedAt: blocked.stateStartedAt,
        turnStartedAt: blocked.turnStartedAt,
        toolName: 'ask',
        mainAgent: { state: 'blocked', stateStartedAt: blocked.stateStartedAt }
      })
      expect(afterChildTools.interactivePrompt).toBe(blocked.interactivePrompt)
      expect(
        parseAskFromStatus(afterChildTools.interactivePrompt, afterChildTools.toolName)
      ).toEqual(question)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['QuestionChild'])

      await fixture.harness.callHook('tool_execution_end', { toolName: 'ask' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      const resumed = consumePostedRequests()
      expect(resumed).toMatchObject({
        state: 'working',
        turnStartedAt: blocked.turnStartedAt,
        mainAgent: { state: 'working' }
      })
      expect(resumed.stateStartedAt).toBeGreaterThan(blocked.stateStartedAt)
      expect(resumed.interactivePrompt).not.toBe(blocked.interactivePrompt)
      expect(parseAskFromStatus(resumed.interactivePrompt, resumed.toolName)).toBeNull()
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
      server.stop()
    }
  })

  it('refreshes quiet native work and its root evidence without starting another turn', async () => {
    const root = nativeRoot('quiet-root', true)
    const child = nativeChild('QuietChild', root.file)
    const fixture = createNativeFixture(root, [child])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      await fixture.harness.callHook(
        'before_agent_start',
        { prompt: 'Keep the root registry evidence visible.' },
        root.context
      )
      await fixture.harness.callHook('agent_start', {}, root.context)
      await fixture.harness.callHook(
        'message_end',
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'The root preview is not child traffic.' }]
          }
        },
        root.context
      )
      await fixture.harness.callHook(
        'tool_execution_start',
        { toolName: 'read', args: { path: 'src/registry.ts' } },
        root.context
      )
      await vi.advanceTimersByTimeAsync(1_000)

      const verified = latestSnapshot(fixture)
      expect(verified.payload.omp_status).toMatchObject({
        state: 'working',
        prompt: 'Keep the root registry evidence visible.',
        tool_name: 'read',
        tool_input: { path: 'src/registry.ts' },
        role: 'assistant',
        text: 'The root preview is not child traffic.'
      })
      expect(verified.payload.omp_status).not.toHaveProperty('session_boundary')
      const beforeRefresh = fixture.delivered.length

      // Silence alone would make the retained child row unverifiable; a new native read
      // must supply fresh evidence even though neither the child nor root emitted a hook.
      vi.setSystemTime(verified.observedAt + AGENT_STATUS_STALE_AFTER_MS + 1)
      expect(childRows(verified.payload, verified.observedAt)).toEqual([
        expect.objectContaining({ id: child.id, displayState: 'unverifiable' })
      ])
      await vi.advanceTimersByTimeAsync(6_000)

      const refreshed = latestSnapshot(fixture)
      expect(refreshed.observedAt).toBeGreaterThan(verified.observedAt)
      expect(refreshed.payload).toMatchObject({
        session_id: 'quiet-root',
        session_file: root.file,
        omp_status: verified.payload.omp_status
      })
      expect(childRows(refreshed.payload, refreshed.observedAt)).toEqual([
        expect.objectContaining({
          id: child.id,
          name: child.id,
          displayState: 'working',
          firstObservedAt: child.createdAt,
          recencyAt: refreshed.observedAt
        })
      ])
      const quietPosts = fixture.delivered.slice(beforeRefresh)
      expect(quietPosts.some(({ payload }) => payload.hook_event_name === 'subagents_update')).toBe(
        true
      )
      expect(
        quietPosts.filter(({ payload }) =>
          ['before_agent_start', 'agent_start', 'agent_end'].includes(payload.hook_event_name)
        )
      ).toEqual([])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it('reconciles native completion and cancellation before finishing a settled root', async () => {
    const root = nativeRoot('settled-root', true)
    const completed = nativeChild('CompletedChild', root.file)
    const cancelled = nativeChild('CancelledChild', root.file, NATIVE_TIME - 46)
    const fixture = createNativeFixture(root, [completed, cancelled])
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      root.session.isStreaming = false
      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({ state: 'done' })
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([
        'CancelledChild',
        'CompletedChild'
      ])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])

      fixture.setStatus(completed, 'idle')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(childIds(latestSnapshot(fixture).payload)).toEqual(['CancelledChild'])
      expect(childRows(latestSnapshot(fixture).payload)).toEqual([
        expect.objectContaining({ id: 'CancelledChild', displayState: 'working' })
      ])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])

      fixture.setStatus(cancelled, 'aborted')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(latestSnapshot(fixture).payload).toMatchObject({
        session_id: 'settled-root',
        session_file: root.file,
        omp_status: { state: 'done' }
      })
      expect(childIds(latestSnapshot(fixture).payload)).toEqual([])
      expect(childIds(latestPost(fixture).payload)).toEqual([])
      const completions = postedPayloads(fixture.harness).filter(
        (payload) => payload.hook_event_name === 'agent_end'
      )
      expect(completions).toHaveLength(1)
      expect(completions[0]).toMatchObject({
        session_id: 'settled-root',
        session_file: root.file
      })
      expect(completions[0]).not.toHaveProperty('session_boundary')

      await vi.advanceTimersByTimeAsync(12_000)
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toHaveLength(1)
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it.each(['idle', 'removed'] as const)(
    'does not mistake last-child %s for completion of a still-running root',
    async (settlement) => {
      const root = nativeRoot('executing-root', true)
      const child = nativeChild('FinishedChild', root.file)
      const fixture = createNativeFixture(root, [child])
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook('agent_start', {}, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        if (settlement === 'idle') {
          fixture.setStatus(child, 'idle')
        } else {
          fixture.refs.delete(child.id)
          fixture.notify('removed', child)
        }
        await vi.advanceTimersByTimeAsync(1_000)

        expect(childIds(latestSnapshot(fixture).payload)).toEqual([])
        expect(latestSnapshot(fixture).payload.omp_status).toMatchObject({ state: 'working' })
        expect(
          postedPayloads(fixture.harness).filter(
            (payload) => payload.hook_event_name === 'agent_end'
          )
        ).toEqual([])

        root.session.isStreaming = false
        await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(
          postedPayloads(fixture.harness).filter(
            (payload) => payload.hook_event_name === 'agent_end'
          )
        ).toHaveLength(1)
        expect(childIds(latestPost(fixture).payload)).toEqual([])
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it('includes scoped descendants but excludes unrelated, old-session and retained inactive refs', async () => {
    const root = nativeRoot('current-root')
    root.ref.status = 'idle'
    const direct = nativeChild('DirectChild', root.file)
    const nested = nativeChild('NestedChild', direct.sessionFile, NATIVE_TIME - 46)
    nested.parentId = direct.id
    const otherRoot = nativeRoot('other-root', true)
    otherRoot.ref.id = 'OtherMain'
    otherRoot.ref.displayName = 'OtherMain'
    // A matching transcript path alone cannot make another root's child ours.
    const unrelated = nativeChild('UnrelatedChild', root.file)
    unrelated.parentId = otherRoot.ref.id
    const oldGeneration = nativeChild('PreviousRootChild', '/sessions/previous-root.jsonl')
    const orphan = nativeChild('OrphanChild', root.file)
    orphan.parentId = 'MissingParent'
    const idle = nativeChild('IdleChild', root.file)
    idle.status = 'idle'
    idle.session.isStreaming = false
    const parked: NativeRef = nativeChild('ParkedChild', root.file)
    parked.status = 'parked'
    parked.session = null
    const aborted: NativeRef = nativeChild('AbortedChild', root.file)
    aborted.status = 'aborted'
    aborted.session = null
    const advisor = nativeChild('AdvisorChild', root.file)
    advisor.kind = 'advisor'
    const fixture = createNativeFixture(root, [
      direct,
      nested,
      otherRoot.ref,
      unrelated,
      oldGeneration,
      orphan,
      idle,
      parked,
      aborted,
      advisor
    ])

    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)

      const scoped = latestSnapshot(fixture)
      expect(scoped.payload).toMatchObject({
        session_id: 'current-root',
        session_file: root.file,
        omp_status: { state: 'done', session_boundary: true }
      })
      expect(childIds(scoped.payload)).toEqual(['DirectChild', 'NestedChild'])
      expect(childRows(scoped.payload, scoped.observedAt)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'DirectChild',
            name: 'DirectChild',
            displayState: 'working'
          }),
          expect.objectContaining({
            id: 'NestedChild',
            name: 'NestedChild',
            displayState: 'working'
          })
        ])
      )
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })

  it.each(OMP_RUNTIME_CASES)(
    'keeps lifecycle membership and completion working when %s has no native registry',
    async (_name, runtime) => {
      const root = nativeRoot('legacy-omp-root', true)
      const fixture = createNativeFixture(root, [nativeChild('UnobservedNativeChild', root.file)], {
        runtime,
        registryAvailable: false
      })
      try {
        await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
        await fixture.harness.callHook('agent_start', {}, root.context)
        fixture.harness.emitPiEvent('task:subagent:lifecycle', {
          id: 'LegacyOmpChild',
          agent: 'scout',
          description: 'Lifecycle-only OMP child',
          status: 'started'
        })
        await vi.advanceTimersByTimeAsync(1_000)
        expect(childIds(latestPost(fixture).payload)).toEqual(['LegacyOmpChild'])
        expect(childRows(latestPost(fixture).payload)).toEqual([
          expect.objectContaining({
            id: 'LegacyOmpChild',
            name: 'Lifecycle-only OMP child',
            agentType: 'scout',
            displayState: 'working'
          })
        ])

        root.session.isStreaming = false
        await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(
          postedPayloads(fixture.harness).filter(
            (payload) => payload.hook_event_name === 'agent_end'
          )
        ).toEqual([])
        fixture.harness.emitPiEvent('task:subagent:lifecycle', {
          id: 'LegacyOmpChild',
          status: 'completed'
        })
        await vi.advanceTimersByTimeAsync(1_000)
        expect(childIds(latestPost(fixture).payload)).toEqual([])
        expect(
          postedPayloads(fixture.harness).filter(
            (payload) => payload.hook_event_name === 'agent_end'
          )
        ).toHaveLength(1)
        expect(
          postedPayloads(fixture.harness).some((payload) => payload.omp_status !== undefined)
        ).toBe(false)
      } finally {
        await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it('does not apply native OMP membership or terminal-end semantics to genuine Pi', async () => {
    const root = nativeRoot('genuine-pi-root', true)
    const fixture = createNativeFixture(root, [nativeChild('OmpOnlyChild', root.file)], {
      runtime: { kind: 'pi' }
    })
    try {
      await fixture.harness.callHook('session_start', { reason: 'startup' }, root.context)
      await fixture.harness.callHook('agent_start', {}, root.context)
      fixture.harness.emitPiEvent('subagent:async-started', {
        id: 'PiAsyncChild',
        agent: 'scout',
        description: 'Pi async child'
      })
      await vi.advanceTimersByTimeAsync(6_000)
      expect(childIds(latestPost(fixture).payload)).toEqual(['PiAsyncChild'])
      expect(childRows(latestPost(fixture).payload)).toEqual([
        expect.objectContaining({
          id: 'PiAsyncChild',
          name: 'Pi async child',
          agentType: 'scout',
          displayState: 'working'
        })
      ])

      await fixture.harness.callHook('agent_end', { willContinue: false }, root.context)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toEqual([])
      root.session.isStreaming = false
      await fixture.harness.callHook('agent_settled', undefined, root.context)
      fixture.harness.emitPiEvent('subagent:async-complete', { id: 'PiAsyncChild' })
      await vi.advanceTimersByTimeAsync(1_000)

      expect(childIds(latestPost(fixture).payload)).toEqual([])
      expect(
        postedPayloads(fixture.harness).filter((payload) => payload.hook_event_name === 'agent_end')
      ).toHaveLength(1)
      expect(
        postedPayloads(fixture.harness).some((payload) => payload.omp_status !== undefined)
      ).toBe(false)
    } finally {
      await fixture.harness.callHook('session_shutdown', { reason: 'quit' }, root.context)
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})
