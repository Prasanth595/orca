import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { AgentHookServer } from '../agent-hooks/server'
import { buildBody, PANE } from '../agent-hooks/server.test-fixtures'
import {
  NATIVE_TIME,
  createNativeFixture,
  nativeChild,
  nativeRoot,
  type NativeRef,
  type NativeRoot
} from './agent-status-extension-omp-registry-fixture'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

let server: AgentHookServer
const consume = () => server.getStatusSnapshot().find((entry) => entry.paneKey === PANE)
const receive = async (payload: Record<string, unknown>) => {
  const event = normalizeHookPayload(
    server._getStateForTests(),
    'omp',
    buildBody(payload),
    'production'
  )
  if (event) {
    server.ingestRemote(event, null)
  }
  return { ok: true }
}
function fixtureFor(root: NativeRoot, children: NativeRef[] = []) {
  return createNativeFixture(root, children, {
    env: {
      ORCA_AGENT_HOOK_ENV: 'production',
      ORCA_PANE_KEY: PANE,
      ORCA_AGENT_LAUNCH_TOKEN: undefined
    },
    delivery: receive
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NATIVE_TIME)
  server = new AgentHookServer()
})
afterEach(() => {
  server.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('native OMP registry through the host status store', () => {
  it('recovers named missed starts and orphaned completion without resetting quiet clocks', async () => {
    const root = nativeRoot('quiet-root')
    const children = [nativeChild('NamedLeft', root.file), nativeChild('NamedRight', root.file)]
    const fixture = fixtureFor(root, children)
    await fixture.harness.callHook('session_start', {}, root.context)
    await vi.advanceTimersByTimeAsync(1_000)
    const initial = consume()!
    expect(initial?.subagents).toEqual(
      children.map((child) =>
        expect.objectContaining({
          id: child.id,
          description: child.id,
          startedAt: child.createdAt
        })
      )
    )
    expect(initial).toMatchObject({ state: 'working', mainAgent: { state: 'done' } })
    expect(initial.turnStartedAt).toBeUndefined()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(consume()).toMatchObject({
      stateStartedAt: initial.stateStartedAt,
      mainAgent: initial.mainAgent,
      subagents: initial.subagents
    })
    expect(consume()!.receivedAt).toBeGreaterThan(initial.receivedAt)
    expect(consume()!.turnStartedAt).toBeUndefined()
    fixture.setStatus(children[0]!, 'idle')
    fixture.setStatus(children[1]!, 'aborted')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()?.state).toBe('done')
    expect(consume()?.subagents ?? []).toEqual([])
  })

  it('holds completion for async work beyond the display cap and preserves the root completion clock', async () => {
    const root = nativeRoot('async-root')
    let rootPending = true
    root.ref.status = 'idle'
    root.session.hasPendingAsyncWork = () => rootPending
    const children = Array.from({ length: 33 }, (_, index) =>
      nativeChild(`Child${index}`, root.file)
    )
    const fixture = fixtureFor(root, children)
    await fixture.harness.callHook('session_start', {}, root.context)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'working' } })
    const shown = consume()!.subagents!.map(({ id }) => id)
    expect(shown).toHaveLength(32)
    const hidden = children.find(({ id }) => !shown.includes(id))!
    let childPending = true
    hidden.session.hasPendingAsyncWork = () => childPending
    await fixture.harness.callHook('agent_start', {}, root.context)
    rootPending = false
    await fixture.harness.callHook('agent_end', {}, root.context)
    children.forEach((child) => fixture.setStatus(child, 'idle'))
    await vi.advanceTimersByTimeAsync(6_000)
    const held = consume()!
    expect(held).toMatchObject({
      state: 'working',
      mainAgent: { state: 'done' },
      subagents: [expect.objectContaining({ id: hidden.id, state: 'working' })]
    })
    childPending = false
    hidden.session.isStreaming = true
    fixture.setStatus(hidden, 'running')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()?.state).toBe('working')
    fixture.setStatus(hidden, 'idle')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()).toMatchObject({ state: 'done', mainAgent: held.mainAgent })
    expect(consume()?.subagents ?? []).toEqual([])
    expect(consume()!.stateStartedAt).toBeGreaterThan(held.mainAgent!.stateStartedAt)
  })

  it('does not refresh or clear failed reads and recovers a silent session attachment', async () => {
    const root = nativeRoot('uncertain-root', true)
    const first = nativeChild('PreviouslyVerified', root.file)
    const fixture = fixtureFor(root, [first])
    await fixture.harness.callHook('session_start', {}, root.context)
    await fixture.harness.callHook('agent_start', {}, root.context)
    await vi.advanceTimersByTimeAsync(1_000)
    root.session.isStreaming = false
    await fixture.harness.callHook('agent_end', {}, root.context)
    await vi.advanceTimersByTimeAsync(1_000)
    const verified = consume()
    fixture.failList(new Error('Native enumeration unavailable'))
    fixture.setStatus(first, 'idle')
    await vi.advanceTimersByTimeAsync(12_000)
    expect(consume()).toEqual(verified)
    fixture.failList()
    const attaching: NativeRef = nativeChild('Attaching', root.file)
    const session = attaching.session
    const file = attaching.sessionFile
    attaching.session = null
    attaching.sessionFile = ''
    fixture.refs.set(attaching.id, attaching)
    fixture.notify('registered', attaching)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(consume()).toEqual(verified)
    attaching.session = session
    attaching.sessionFile = file
    await vi.advanceTimersByTimeAsync(6_000)
    expect(consume()).toMatchObject({
      state: 'working',
      subagents: [expect.objectContaining({ id: attaching.id })]
    })
    expect(consume()!.receivedAt).toBeGreaterThan(verified!.receivedAt)
    fixture.setStatus(attaching, 'idle')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()?.state).toBe('done')
    expect(consume()?.subagents ?? []).toEqual([])
  })

  it('requires positive native evidence before seeding an untouched root', async () => {
    const root = nativeRoot('unreadable-root')
    let unavailable = true
    root.session.hasPendingAsyncWork = () => {
      if (unavailable) {
        throw new Error('Native execution unavailable')
      }
      return true
    }
    const fixture = fixtureFor(root)
    await fixture.harness.callHook('session_start', {}, root.context)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(consume()).toBeUndefined()
    unavailable = false
    await vi.advanceTimersByTimeAsync(6_000)
    expect(consume()).toMatchObject({ state: 'working', mainAgent: { state: 'working' } })
  })

  it('preserves root input, prompt and turn clocks across reload and quiet verification', async () => {
    const root = nativeRoot('human-wait-root', true)
    root.context.hasUI = true
    const { harness } = fixtureFor(root)
    const questions = { questions: [{ id: 'scope', question: 'Which scope?' }] }
    await harness.callHook('session_start', {}, root.context)
    await harness.callHook('before_agent_start', { prompt: 'Inspect scope.' }, root.context)
    await harness.callHook('agent_start', {}, root.context)
    await harness.callHook(
      'tool_execution_start',
      { toolName: 'ask', args: questions },
      root.context
    )
    await harness.callHook(
      'tool_approval_requested',
      {
        toolName: 'bash',
        reason: 'Allow inspection?'
      },
      root.context
    )
    await vi.advanceTimersByTimeAsync(1_000)
    const asking = consume()!
    expect(asking).toMatchObject({
      state: 'blocked',
      prompt: 'Inspect scope.',
      toolName: 'ask',
      interactivePrompt: JSON.stringify(questions)
    })
    harness.reload()
    await harness.callHook('session_start', { reason: 'reload' }, root.context)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(consume()).toMatchObject({
      state: asking.state,
      prompt: asking.prompt,
      toolName: asking.toolName,
      interactivePrompt: asking.interactivePrompt,
      stateStartedAt: asking.stateStartedAt,
      turnStartedAt: asking.turnStartedAt
    })
    await harness.callHook('tool_execution_end', { toolName: 'ask' }, root.context)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()).toMatchObject({
      state: 'blocked',
      toolName: 'bash',
      toolInput: 'Allow inspection?',
      turnStartedAt: asking.turnStartedAt
    })
    expect(consume()?.interactivePrompt).toBeUndefined()
    await harness.callHook(
      'tool_execution_start',
      { toolName: 'bash', args: { command: 'pwd' } },
      root.context
    )
    await harness.callHook(
      'tool_approval_resolved',
      {
        toolName: 'bash',
        approved: true
      },
      root.context
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(consume()?.state).toBe('working')
    expect(consume()?.toolInput).toBeUndefined()
    await vi.advanceTimersByTimeAsync(200)
    expect(consume()).toMatchObject({
      state: 'working',
      prompt: asking.prompt,
      turnStartedAt: asking.turnStartedAt
    })
    expect(consume()?.toolInput).toBeUndefined()
  })

  it('fences child factories, foreign roots and stale callbacks across a session replacement', async () => {
    const before = nativeRoot('before-root', true)
    const oldChild = nativeChild('OldWorker', before.file)
    const fixture = fixtureFor(before, [oldChild])
    const { harness } = fixture
    const replacement = harness.registerTaskChild()
    const childFactory = harness.registerTaskChild()
    const after = nativeRoot('after-root', true)
    await harness.callHook('session_start', {}, before.context)
    await harness.callHook('before_agent_start', { prompt: 'Old scope only.' }, before.context)
    await vi.advanceTimersByTimeAsync(1_000)
    const verified = consume()
    const delayed = harness.fetchMock.mock.calls.find(([, init]) => {
      const payload = JSON.parse(String(init?.body)).payload
      return payload.hook_event_name === 'subagents_update' && payload.omp_status
    })![1]!.body
    const delayedPrompt = harness.fetchMock.mock.calls.find(([, init]) => {
      const payload = JSON.parse(String(init?.body)).payload
      return (
        payload.hook_event_name === 'subagents_update' &&
        payload.omp_status?.prompt === 'Old scope only.'
      )
    })![1]!.body
    await childFactory.callHook(
      'session_start',
      {},
      {
        agent: { id: oldChild.id, kind: 'sub', parentId: 'Main' },
        sessionManager: oldChild.session.sessionManager
      }
    )
    await childFactory.callHook('session_start', {}, after.context)
    await childFactory.callHook('session_shutdown', {}, after.context)
    expect(consume()).toEqual(verified)
    const staleCallback = fixture.captureNotification()
    const ancestor = nativeChild('IdleAncestor', after.file)
    ancestor.status = 'idle'
    ancestor.session.isStreaming = false
    const child = nativeChild('CurrentWorker', ancestor.sessionFile)
    child.parentId = ancestor.id
    const foreign = nativeChild('ForeignWorker', after.file)
    foreign.parentId = 'OtherMain'
    for (const ref of [after.ref, ancestor, child, foreign]) {
      fixture.refs.set(ref.id, ref)
    }
    staleCallback('metadata_changed', oldChild)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()).toEqual(verified)
    await replacement.callHook('session_start', {}, after.context)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()).toMatchObject({
      state: 'working',
      prompt: '',
      providerSession: { id: 'after-root', transcriptPath: after.file },
      subagents: [expect.objectContaining({ id: child.id })]
    })
    expect(consume()?.turnStartedAt).toBeUndefined()
    const current = consume()
    await receive(JSON.parse(String(delayed)).payload)
    expect(consume()).toEqual(current)
    await harness.callHook('session_shutdown', {}, before.context)
    staleCallback('registered', oldChild)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(consume()).toMatchObject({
      providerSession: current!.providerSession,
      subagents: current!.subagents
    })
    expect(consume()!.receivedAt).toBeGreaterThan(current!.receivedAt)
    const resumedRegistration = harness.registerTaskChild()
    const resumedRoot = nativeRoot('before-root', true)
    fixture.refs.set(resumedRoot.ref.id, resumedRoot.ref)
    await resumedRegistration.callHook('session_start', {}, resumedRoot.context)
    await resumedRegistration.callHook(
      'before_agent_start',
      { prompt: 'Fresh resumed scope.' },
      resumedRoot.context
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(consume()).toMatchObject({
      state: 'working',
      prompt: 'Fresh resumed scope.',
      providerSession: { id: 'before-root', transcriptPath: before.file }
    })
    const resumed = consume()
    await receive(JSON.parse(String(delayedPrompt)).payload)
    expect(consume()).toEqual(resumed)
  })
})
