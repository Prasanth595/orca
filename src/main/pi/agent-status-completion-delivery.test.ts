import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeHookPayload } from '../../shared/agent-hook-listener'
import { PANE_KEY } from '../../shared/agent-hook-listener-test-harness'
import type { AgentHookEventPayload } from '../../shared/agent-hook-listener/listener-event'
import {
  createHookListenerState,
  seedLegacyAgentStatusForTests
} from '../../shared/agent-hook-listener/listener-state'
import {
  createAgentStatusExtensionHarness,
  type AgentStatusExtensionHarness
} from './agent-status-extension-test-harness'

function events(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).payload)
}

function nativePosts(harness: AgentStatusExtensionHarness) {
  return harness.fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).payload)
}

function nativeCompletionHarness(kind: 'omp' | 'pi') {
  const rootFile = '/sessions/root.jsonl'
  const childFile = '/sessions/root/ProofChild.jsonl'
  const rootManager = {
    getSessionId: () => 'root',
    getSessionFile: () => rootFile,
    getHeader: () => ({ id: 'root' })
  }
  const childManager = {
    getSessionId: () => 'child',
    getSessionFile: () => childFile,
    getHeader: () => ({ id: 'child', parentSession: rootFile })
  }
  const rootRef = {
    id: 'Main',
    displayName: 'Main',
    kind: 'main' as const,
    status: 'idle',
    session: { sessionManager: rootManager, isStreaming: false },
    sessionFile: rootFile,
    createdAt: Date.now(),
    lastActivity: Date.now()
  }
  const childRef = {
    id: 'ProofChild',
    displayName: 'proof',
    kind: 'sub' as const,
    parentId: 'Main',
    status: 'idle',
    session: { sessionManager: childManager, isStreaming: false },
    sessionFile: childFile,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    history: { agent: 'proof' }
  }
  const refs = new Map([rootRef, childRef].map((ref) => [ref.id, ref]))
  const listeners = new Set<(event: unknown) => void>()
  const registry = {
    list: () => [...refs.values()],
    get: (id: string) => refs.get(id),
    onChange: (listener: (event: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  const harness = createAgentStatusExtensionHarness({
    kind,
    argv: ['bun', '/opt/omp/bin/omp'],
    nativeExtensionNamespace: {
      MAIN_AGENT_ID: 'Main',
      AgentRegistry: { global: () => registry }
    }
  })
  const root = {
    agent: { id: rootRef.id, kind: 'main' as const, depth: 0 },
    sessionManager: rootManager,
    isIdle: () => !rootRef.session.isStreaming
  }
  const child = {
    agent: { id: childRef.id, kind: 'sub' as const, parentId: rootRef.id, depth: 1 },
    sessionManager: childManager,
    isIdle: () => !childRef.session.isStreaming
  }
  const notify = (type: string, ref: unknown): void => {
    for (const listener of listeners) {
      listener({ type, ref })
    }
  }
  return { harness, root, rootRef, child, childRef, refs, notify }
}

describe('OMP completion delivery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['rejection', 'HTTP failure'])(
    'retries a final %s without another turn',
    async (failure) => {
      const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
      await harness.callHook('agent_start')
      await vi.advanceTimersByTimeAsync(0)
      if (failure === 'rejection') {
        harness.fetchMock.mockRejectedValueOnce(new Error('offline'))
      } else {
        harness.fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
      }
      await harness.callHook('agent_end')
      await vi.advanceTimersByTimeAsync(251)
      expect(events(harness.fetchMock)).toEqual([
        { hook_event_name: 'agent_start' },
        { hook_event_name: 'agent_end' },
        { hook_event_name: 'agent_end' }
      ])
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it.each(['HTTP failure', 'timeout'] as const)(
    'delivers the pending WSL root completion after curl %s and recovery',
    async (failure) => {
      const state = createHookListenerState()
      const accepted: AgentHookEventPayload[] = []
      const acceptBody = (body: string): void => {
        const status = normalizeHookPayload(state, 'omp', JSON.parse(body), 'production')
        if (!status) {
          throw new Error('The root hook did not produce a consumer status')
        }
        seedLegacyAgentStatusForTests(state, status)
        accepted.push(status)
      }
      let guestAvailable = true
      const harness = createAgentStatusExtensionHarness({
        kind: 'omp',
        env: {
          WSL_DISTRO_NAME: 'Ubuntu',
          ORCA_PANE_KEY: PANE_KEY,
          ORCA_AGENT_HOOK_ENV: 'production'
        },
        existsSync: (path) => path === '/mnt/c/Windows/System32/curl.exe',
        curlExitCode: null,
        fetchImpl: async (_url, request) => {
          if (!guestAvailable) {
            throw new Error('guest unavailable')
          }
          acceptBody(String(request?.body))
          return { ok: true }
        }
      })
      const root = {
        sessionManager: {
          getSessionId: () => 'wsl-root',
          getSessionFile: () => '/sessions/wsl-root.jsonl',
          getHeader: () => ({ id: 'wsl-root' })
        }
      }
      await harness.callHook('session_start', { reason: 'startup' }, root)
      await harness.callHook('before_agent_start', { prompt: 'Finish the WSL root turn' }, root)
      await vi.advanceTimersByTimeAsync(0)
      await harness.callHook('agent_start', {}, root)
      await vi.advanceTimersByTimeAsync(0)
      await harness.callHook(
        'message_end',
        { message: { role: 'assistant', content: [{ type: 'text', text: 'Root final answer' }] } },
        root
      )
      await vi.advanceTimersByTimeAsync(0)
      guestAvailable = false
      await harness.callHook('agent_end', {}, root)
      await vi.advanceTimersByTimeAsync(0)
      const failedCurl = harness.spawnedChildren.at(-1)
      if (!failedCurl) {
        throw new Error('The failed guest delivery did not use the Windows curl bridge')
      }
      if (failure === 'HTTP failure') {
        failedCurl.emit('close', 22)
        await vi.advanceTimersByTimeAsync(0)
      } else {
        await vi.advanceTimersByTimeAsync(11_001)
      }
      expect(state.lastStatusByPaneKey.get(PANE_KEY)?.payload.state).toBe('working')
      expect(accepted.some((status) => status.hookEventName === 'agent_end')).toBe(false)

      await vi.advanceTimersByTimeAsync(251)
      const recoveredCurl = harness.spawnedChildren.at(-1)
      if (!recoveredCurl || recoveredCurl === failedCurl) {
        throw new Error('The unacknowledged root completion was not retried')
      }
      const recoveredBody = recoveredCurl.stdin.end.mock.calls[0]?.[0]
      if (typeof recoveredBody !== 'string') {
        throw new Error('The recovered Windows curl request did not contain a hook body')
      }
      acceptBody(recoveredBody)
      recoveredCurl.emit('close', 0)
      guestAvailable = true
      await vi.advanceTimersByTimeAsync(60_000)

      expect(accepted.filter((status) => status.hookEventName === 'agent_end')).toHaveLength(1)
      expect(state.lastStatusByPaneKey.get(PANE_KEY)).toMatchObject({
        paneKey: PANE_KEY,
        hookEventName: 'agent_end',
        providerSession: {
          key: 'session_id',
          id: 'wsl-root',
          transcriptPath: '/sessions/wsl-root.jsonl'
        },
        payload: {
          agentType: 'omp',
          state: 'done',
          prompt: 'Finish the WSL root turn',
          lastAssistantMessage: 'Root final answer'
        }
      })
      await harness.callHook('session_shutdown', { reason: 'quit' }, root)
      await vi.advanceTimersByTimeAsync(0)
    }
  )

  it('does not acknowledge a missing WSL curl bridge', async () => {
    const harness = createAgentStatusExtensionHarness({
      kind: 'omp',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      fetchImpl: async () => {
        throw new Error('guest unavailable')
      }
    })
    await harness.callHook('agent_end')
    await vi.advanceTimersByTimeAsync(251)
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)
    await harness.callHook('session_shutdown')
  })

  it('waits for WSL curl acknowledgment before draining a newer snapshot', async () => {
    const harness = createAgentStatusExtensionHarness({
      kind: 'omp',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      existsSync: (path) => path === '/mnt/c/Windows/System32/curl.exe',
      curlExitCode: null,
      fetchImpl: async () => {
        throw new Error('guest unavailable')
      }
    })
    await harness.callHook('agent_end')
    await vi.advanceTimersByTimeAsync(0)
    await harness.callHook('agent_start')
    expect(harness.fetchMock).toHaveBeenCalledTimes(1)
    harness.spawnedChildren[0]?.emit('close', 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.fetchMock).toHaveBeenCalledTimes(2)
    harness.spawnedChildren[1]?.emit('close', 0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['before_agent_start', 'agent_start'])(
    'retires a failed completion at %s',
    async (boundary) => {
      const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
      harness.fetchMock.mockRejectedValueOnce(new Error('offline'))
      await harness.callHook('agent_end')
      await vi.advanceTimersByTimeAsync(0)
      await harness.callHook(boundary, {})
      await vi.advanceTimersByTimeAsync(10_000)
      expect(
        events(harness.fetchMock).filter((event) => JSON.stringify(event).includes('agent_end'))
      ).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('does not schedule retries when a pending completion fails after a new start', async () => {
    let rejectDelivery: ((error: Error) => void) | undefined
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    harness.fetchMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectDelivery = reject
        })
    )
    await harness.callHook('agent_end')
    await harness.callHook('agent_start')
    rejectDelivery?.(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events(harness.fetchMock)).toEqual([
      { hook_event_name: 'agent_end' },
      { hook_event_name: 'agent_start' }
    ])
  })

  it.each(['scheduled retry', 'in-flight failure', 'in-flight success'] as const)(
    'preserves completion delivery across a session boundary after %s',
    async (delivery) => {
      const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
      let id = 'A'
      const ctx = {
        isIdle: () => true,
        sessionManager: { getSessionId: () => id, getSessionFile: () => `/sessions/${id}.jsonl` }
      }
      await harness.callHook('agent_start', {}, ctx)
      await vi.advanceTimersByTimeAsync(0)
      let acknowledge: ((value: { ok: boolean }) => void) | undefined
      let fail: ((error: Error) => void) | undefined
      if (delivery === 'scheduled retry') {
        harness.fetchMock.mockRejectedValueOnce(new Error('offline'))
      } else {
        harness.fetchMock.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              acknowledge = resolve
              fail = reject
            })
        )
      }
      await harness.callHook('agent_end', {}, ctx)
      await vi.advanceTimersByTimeAsync(0)
      id = 'B'
      await harness.callHook('session_switch', { reason: 'new' }, ctx)
      await harness.callHook('agent_start', {}, ctx)
      if (delivery === 'in-flight failure') {
        fail?.(new Error('late failure'))
      } else {
        acknowledge?.({ ok: true })
      }
      await vi.advanceTimersByTimeAsync(5_000)

      const payloads = events(harness.fetchMock)
      const completions = payloads.filter(
        (event) =>
          event &&
          typeof event === 'object' &&
          'hook_event_name' in event &&
          event.hook_event_name === 'agent_end'
      )
      expect(completions).toHaveLength(delivery === 'in-flight success' ? 1 : 2)
      for (const completion of completions) {
        expect(completion).toMatchObject({ session_id: 'A' })
      }
      expect(payloads.at(-1)).toMatchObject({ hook_event_name: 'agent_start', session_id: 'B' })
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('retries a timed out completion without blocking agent handlers', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    harness.fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    await harness.callHook('agent_end')
    await vi.advanceTimersByTimeAsync(1251)
    expect(events(harness.fetchMock)).toEqual([
      { hook_event_name: 'agent_end' },
      { hook_event_name: 'agent_end' }
    ])
    expect(harness.fetchMock.mock.calls[0]?.[1]?.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds retries when Orca stays unreachable', async () => {
    const harness = createAgentStatusExtensionHarness({
      kind: 'omp',
      fetchImpl: async () => {
        throw new Error('offline')
      }
    })
    await harness.callHook('agent_end')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.fetchMock).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  describe.each(['omp', 'pi'] as const)('native %s registration isolation', (kind) => {
    it.each(['scheduled retry', 'in-flight failure', 'in-flight success'] as const)(
      'preserves an unacknowledged root completion through child load and shutdown after %s',
      async (delivery) => {
        const { harness, root, rootRef, child } = nativeCompletionHarness(kind)
        await harness.callHook('session_start', { reason: 'startup' }, root)
        await vi.advanceTimersByTimeAsync(1_000)
        rootRef.status = 'running'
        rootRef.session.isStreaming = true
        await harness.callHook('agent_start', {}, root)
        await vi.advanceTimersByTimeAsync(1_000)
        harness.fetchMock.mockClear()

        const accepted: Record<string, unknown>[] = []
        let completionAttempts = 0
        let acknowledge: (() => void) | undefined
        let fail: ((error: Error) => void) | undefined
        harness.fetchMock.mockImplementation((_url, request) => {
          const payload = JSON.parse(String(request?.body)).payload
          if (payload.hook_event_name === 'agent_end' && completionAttempts++ === 0) {
            if (delivery === 'scheduled retry') {
              return Promise.reject(new Error('offline'))
            }
            const { promise, resolve, reject } = Promise.withResolvers<{ ok: boolean }>()
            acknowledge = () => resolve({ ok: true })
            fail = reject
            request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true
            })
            return promise.then((response) => {
              accepted.push(payload)
              return response
            })
          }
          accepted.push(payload)
          return Promise.resolve({ ok: true })
        })

        try {
          rootRef.status = 'idle'
          rootRef.session.isStreaming = false
          await harness.callHook('agent_end', {}, root)
          await vi.advanceTimersByTimeAsync(0)
          expect(
            nativePosts(harness).filter((post) => post.hook_event_name === 'agent_end')
          ).toHaveLength(1)

          const registration = harness.registerTaskChild()
          await registration.callHook('session_start', { reason: 'startup' }, child)
          await registration.callHook('agent_start', {}, child)
          await registration.callHook(
            'message_end',
            { message: { role: 'assistant', content: [{ type: 'text', text: 'child answer' }] } },
            child
          )
          await registration.callHook('agent_end', {}, child)
          await registration.callHook('session_shutdown', { reason: 'quit' }, child)

          if (delivery === 'in-flight failure') {
            if (!fail) {
              throw new Error('The root completion was not in flight')
            }
            fail(new Error('late failure'))
          } else if (delivery === 'in-flight success') {
            if (!acknowledge) {
              throw new Error('The root completion was not in flight')
            }
            acknowledge()
          }
          await vi.advanceTimersByTimeAsync(1_000)

          expect(accepted.filter((post) => post.hook_event_name === 'agent_end')).toEqual([
            expect.objectContaining({
              hook_event_name: 'agent_end',
              session_id: 'root',
              session_file: '/sessions/root.jsonl'
            })
          ])
          expect(completionAttempts).toBe(delivery === 'in-flight success' ? 1 : 2)
          expect(nativePosts(harness).every((post) => post.session_id === 'root')).toBe(true)
          expect(nativePosts(harness).some((post) => post.text === 'child answer')).toBe(false)
        } finally {
          acknowledge?.()
          await harness.callHook('session_shutdown', { reason: 'quit' }, root)
          await vi.advanceTimersByTimeAsync(0)
        }
      }
    )

    it.each(['child registration', 'retired native Main'] as const)(
      'preserves native observation and held root completion after %s callbacks',
      async (intruder) => {
        const { harness, root, rootRef, child, childRef, refs, notify } =
          nativeCompletionHarness(kind)
        let currentRoot = root
        let currentRef = rootRef
        if (intruder === 'retired native Main') {
          await harness.callHook('session_start', { reason: 'startup' }, root)
          await vi.advanceTimersByTimeAsync(1_000)
          const manager = {
            getSessionId: () => 'replacement',
            getSessionFile: () => '/sessions/replacement.jsonl',
            getHeader: () => ({ id: 'replacement' })
          }
          currentRef = {
            ...rootRef,
            id: 'ReplacementMain',
            session: { sessionManager: manager, isStreaming: false },
            sessionFile: '/sessions/replacement.jsonl'
          }
          refs.set(currentRef.id, currentRef)
          rootRef.status = 'running'
          rootRef.session.isStreaming = true
          currentRoot = {
            agent: { id: currentRef.id, kind: 'main', depth: 0 },
            sessionManager: manager,
            isIdle: () => !currentRef.session.isStreaming
          }
          childRef.parentId = currentRef.id
          childRef.sessionFile = '/sessions/replacement/ProofChild.jsonl'
          childRef.session.sessionManager = {
            getSessionId: () => 'replacement-child',
            getSessionFile: () => childRef.sessionFile,
            getHeader: () => ({ id: 'replacement-child', parentSession: currentRef.sessionFile })
          }
        }
        childRef.status = 'running'
        childRef.session.isStreaming = true
        currentRef.status = 'running'
        currentRef.session.isStreaming = true

        try {
          await harness.callHook('session_start', { reason: 'startup' }, currentRoot)
          await harness.callHook('before_agent_start', { prompt: 'root prompt' }, currentRoot)
          await harness.callHook('agent_start', {}, currentRoot)
          await harness.callHook(
            'message_end',
            { message: { role: 'assistant', content: [{ type: 'text', text: 'root answer' }] } },
            currentRoot
          )
          currentRef.status = 'idle'
          currentRef.session.isStreaming = false
          await harness.callHook('agent_end', {}, currentRoot)
          await vi.advanceTimersByTimeAsync(1_000)
          const heldPosts = nativePosts(harness)
          expect(heldPosts.filter((post) => post.hook_event_name === 'agent_end')).toHaveLength(0)
          expect(
            heldPosts.findLast((post) => post.hook_event_name === 'subagents_update')
          ).toMatchObject({
            session_id: currentRoot.sessionManager.getSessionId(),
            subagents: [{ id: 'ProofChild', state: 'working' }],
            omp_status: { state: 'done', text: 'root answer' }
          })
          harness.fetchMock.mockClear()

          const registration =
            intruder === 'child registration' ? harness.registerTaskChild() : harness
          const context = intruder === 'child registration' ? child : root
          for (const name of [
            'before_agent_start',
            'agent_start',
            'tool_call',
            'tool_execution_start',
            'tool_execution_end',
            'tool_approval_requested',
            'tool_approval_resolved',
            'message_end',
            'agent_end',
            'agent_settled',
            'session_shutdown',
            'session_start'
          ]) {
            await registration.callHook(
              name,
              {
                reason: 'quit',
                prompt: 'intruder prompt',
                toolName: 'read',
                input: { path: '/intruder.txt' },
                args: { path: '/intruder.txt' },
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'intruder answer' }]
                }
              },
              context
            )
          }
          await vi.advanceTimersByTimeAsync(1_000)
          expect(
            nativePosts(harness).filter((post) => post.hook_event_name === 'agent_end')
          ).toHaveLength(0)

          childRef.history.agent = 'updated-role'
          childRef.lastActivity = Date.now()
          notify('metadata_changed', childRef)
          await vi.advanceTimersByTimeAsync(1_000)
          const active = nativePosts(harness).findLast(
            (post) => post.hook_event_name === 'subagents_update'
          )
          expect(active).toMatchObject({
            session_id: currentRoot.sessionManager.getSessionId(),
            session_file: currentRef.sessionFile,
            subagents: [{ id: 'ProofChild', agentType: 'updated-role', state: 'working' }],
            omp_status: { state: 'done', prompt: 'root prompt', text: 'root answer' }
          })
          expect(nativePosts(harness).some((post) => post.text === 'intruder answer')).toBe(false)

          childRef.status = 'idle'
          childRef.session.isStreaming = false
          notify('status_changed', childRef)
          await vi.advanceTimersByTimeAsync(1_000)
          const posts = nativePosts(harness)
          expect(posts.filter((post) => post.hook_event_name === 'agent_end')).toEqual([
            expect.objectContaining({
              session_id: currentRoot.sessionManager.getSessionId(),
              session_file: currentRef.sessionFile
            })
          ])
          expect(
            posts.findLast((post) => post.hook_event_name === 'subagents_update')
          ).toMatchObject({
            session_id: currentRoot.sessionManager.getSessionId(),
            subagents: [],
            omp_status: { state: 'done', text: 'root answer' }
          })
        } finally {
          await harness.callHook('session_shutdown', { reason: 'quit' }, currentRoot)
          await vi.advanceTimersByTimeAsync(0)
        }
      }
    )

    it.each(['snapshot', 'completion'] as const)(
      'accepts one root completion and an empty terminal roster after blocked %s HTTP is released',
      async (blockedRequest) => {
        const { harness, root, rootRef, childRef, notify } = nativeCompletionHarness(kind)
        childRef.status = 'running'
        childRef.session.isStreaming = true
        rootRef.status = 'running'
        rootRef.session.isStreaming = true
        await harness.callHook('session_start', { reason: 'startup' }, root)
        await harness.callHook('agent_start', {}, root)
        await harness.callHook(
          'message_end',
          {
            message: { role: 'assistant', content: [{ type: 'text', text: 'root final answer' }] }
          },
          root
        )
        await vi.advanceTimersByTimeAsync(1_000)

        const accepted: Record<string, unknown>[] = []
        let release: (() => void) | undefined
        harness.fetchMock.mockImplementation((_url, request) => {
          const payload = JSON.parse(String(request?.body)).payload
          const shouldBlock =
            blockedRequest === 'completion'
              ? payload.hook_event_name === 'agent_end'
              : payload.hook_event_name === 'subagents_update' &&
                payload.omp_status?.state === 'done' &&
                payload.subagents?.length === 1
          if (shouldBlock && !release) {
            const { promise, resolve } = Promise.withResolvers<{ ok: boolean }>()
            release = () => resolve({ ok: true })
            return promise.then((response) => {
              accepted.push(payload)
              return response
            })
          }
          accepted.push(payload)
          return Promise.resolve({ ok: true })
        })

        try {
          rootRef.status = 'idle'
          rootRef.session.isStreaming = false
          await harness.callHook('agent_end', {}, root)
          await vi.advanceTimersByTimeAsync(0)
          childRef.status = 'idle'
          childRef.session.isStreaming = false
          notify('status_changed', childRef)
          await vi.advanceTimersByTimeAsync(300)
          expect(accepted.filter((post) => post.hook_event_name === 'agent_end')).toHaveLength(0)
          if (!release) {
            throw new Error(`The ${blockedRequest} HTTP request was not in flight`)
          }
          release()
          await vi.advanceTimersByTimeAsync(1_000)

          expect(accepted.filter((post) => post.hook_event_name === 'agent_end')).toEqual([
            expect.objectContaining({
              session_id: 'root',
              session_file: '/sessions/root.jsonl'
            })
          ])
          expect(accepted).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                hook_event_name: 'subagents_update',
                session_id: 'root',
                session_file: '/sessions/root.jsonl',
                subagents: [],
                omp_status: expect.objectContaining({ state: 'done', text: 'root final answer' })
              })
            ])
          )
        } finally {
          release?.()
          await harness.callHook('session_shutdown', { reason: 'quit' }, root)
          await vi.advanceTimersByTimeAsync(0)
        }
      }
    )
  })
})
