import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentStatusExtensionHarness,
  type AgentStatusExtensionHarness,
  type HookContext
} from './agent-status-extension-test-harness'

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

function nativeOwnerHarness(
  kind: 'omp' | 'pi',
  sessionManager: NonNullable<HookContext['sessionManager']>
) {
  const rootRef = {
    id: 'Main',
    displayName: 'Main',
    kind: 'main' as const,
    status: 'idle',
    session: { sessionManager, isStreaming: false },
    sessionFile: sessionManager.getSessionFile?.(),
    createdAt: Date.now(),
    lastActivity: Date.now()
  }
  const listeners = new Set<(event: unknown) => void>()
  const registry = {
    list: () => [rootRef],
    get: (id: string) => (id === rootRef.id ? rootRef : undefined),
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
    agent: { id: 'Main', kind: 'main' as const, depth: 0 },
    hasUI: false,
    sessionManager,
    isIdle: () => !rootRef.session.isStreaming
  }
  return { harness, root, rootRef }
}

function payloads(harness: AgentStatusExtensionHarness) {
  return harness.fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).payload)
}

describe('OMP session status ownership', () => {
  it.each(['omp', 'pi'] as const)(
    'fences child callbacks before they change %s pane metadata',
    async (kind) => {
      const harness = createAgentStatusExtensionHarness({ kind, argv: ['bun', '/opt/omp/bin/omp'] })
      const root = {
        sessionManager: { getSessionId: () => 'root', getSessionFile: () => '/root.jsonl' }
      }
      await harness.callHook('session_start', {}, root)
      await settle()
      harness.fetchMock.mockClear()
      const rootHandlers = { ...harness.handlers }
      harness.reload()
      const child = {
        sessionManager: { getSessionId: () => 'child', getSessionFile: () => '/child.jsonl' }
      }
      for (const name of [
        'session_start',
        'before_agent_start',
        'agent_start',
        'tool_call',
        'tool_execution_start',
        'tool_execution_end',
        'tool_approval_requested',
        'tool_approval_resolved',
        'message_end',
        'agent_end',
        'agent_settled'
      ]) {
        await harness.callHook(
          name,
          { message: { role: 'assistant', content: 'child answer' } },
          child
        )
        await settle()
      }
      expect(harness.fetchMock).not.toHaveBeenCalled()
      await rootHandlers.agent_start({}, root)
      await settle()
      await rootHandlers.agent_end({}, root)
      await settle()
      const bodies = harness.fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
      expect(bodies.map((body) => body.payload.session_id)).toEqual(['root', 'root'])
      expect(bodies.map((body) => body.payload.session_file)).toEqual([
        '/root.jsonl',
        '/root.jsonl'
      ])
      expect(bodies.at(-1).payload.hook_event_name).toBe('agent_end')
    }
  )

  it('preserves a headless owner through reload, new, and resume', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    let sessionId = 'initial'
    const root = {
      hasUI: false,
      sessionManager: { getSessionId: () => sessionId, getSessionFile: () => '/session.jsonl' }
    }
    await harness.callHook('session_start', {}, root)
    for (const next of ['initial', 'new', 'resumed']) {
      sessionId = next
      harness.reload()
      await harness.callHook('session_start', { reason: 'reload' }, root)
      await harness.callHook('agent_start', {}, root)
      await settle()
    }
    expect(
      harness.fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).payload.session_id)
    ).toEqual(['initial', 'new', 'resumed'])
  })
  it('uses a distinct ownership key when pane and launch change before callbacks', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    const parent = {
      sessionManager: { getSessionId: () => 'parent', getSessionFile: () => '/parent.jsonl' }
    }
    const separate = {
      sessionManager: { getSessionId: () => 'separate', getSessionFile: () => '/separate.jsonl' }
    }
    await harness.callHook('session_start', {}, parent)
    harness.processEnv.ORCA_PANE_KEY = 'pane-2'
    harness.processEnv.ORCA_AGENT_LAUNCH_TOKEN = 'launch-2'
    harness.reload()
    await harness.callHook('agent_start', {}, separate)
    await settle()
    expect(JSON.parse(harness.fetchMock.mock.calls[0][1].body).payload.session_id).toBe('separate')
  })

  it('uses OMP parent metadata and nested task paths when the root already owns the pane', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    const rootFile = '/sessions/root.jsonl'
    const root = {
      sessionManager: {
        getSessionId: () => 'root',
        getSessionFile: () => rootFile,
        getHeader: () => ({ parentSession: undefined })
      }
    }
    await harness.callHook('session_start', {}, root)
    await settle()
    harness.fetchMock.mockClear()
    harness.reload()
    const child = {
      sessionManager: {
        getSessionId: () => 'child',
        getSessionFile: () => '/sessions/root/child.jsonl',
        getHeader: () => ({ parentSession: rootFile })
      }
    }
    await harness.callHook('agent_start', {}, child)
    await settle()
    expect(harness.fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes Windows task transcript paths', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    const rootFile = 'C:\\Users\\orca\\root.jsonl'
    const root = {
      sessionManager: {
        getSessionId: () => 'root-win',
        getSessionFile: () => rootFile,
        getHeader: () => ({})
      }
    }
    await harness.callHook('session_start', {}, root)
    harness.reload()
    const child = {
      sessionManager: {
        getSessionId: () => 'child-win',
        getSessionFile: () => 'c:\\users\\orca\\root\\child.jsonl',
        getHeader: () => ({})
      }
    }
    await harness.callHook('agent_start', {}, child)
    await settle()
    expect(harness.fetchMock).not.toHaveBeenCalled()
  })
  it('keeps reporting for legacy callbacks without a session manager', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    await harness.callHook('agent_start')
    await settle()
    await harness.callHook('agent_end')
    await settle()
    expect(
      harness.fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).payload.hook_event_name)
    ).toEqual(['agent_start', 'agent_end'])
  })

  it('allows a former child transcript resumed without native agent metadata', async () => {
    const harness = createAgentStatusExtensionHarness({ kind: 'omp' })
    const root = {
      hasUI: false,
      sessionManager: {
        getSessionId: () => 'resumed-child',
        getSessionFile: () => '/sessions/parent/subagent/child.jsonl'
      }
    }
    await harness.callHook('session_start', {}, root)
    await harness.callHook('agent_start', {}, root)
    await settle()
    expect(JSON.parse(harness.fetchMock.mock.calls[0][1].body).payload.session_id).toBe(
      'resumed-child'
    )
  })

  it.each(['omp', 'pi'] as const)(
    'rejects explicit native children before legacy %s ownership without a registry capability',
    async (kind) => {
      const harness = createAgentStatusExtensionHarness({ kind, argv: ['bun', '/opt/omp/bin/omp'] })
      for (const childKind of ['sub', 'advisor'] as const) {
        const registration = harness.registerTaskChild()
        const child = {
          agent: { id: `Early-${childKind}`, kind: childKind, parentId: 'Main' },
          sessionManager: {
            getSessionId: () => `child-${childKind}`,
            getSessionFile: () => `/child-${childKind}.jsonl`,
            getHeader: () => ({})
          }
        }
        for (const name of [
          'session_start',
          'agent_start',
          'message_end',
          'agent_end',
          'session_shutdown'
        ]) {
          await registration.callHook(
            name,
            {
              reason: 'quit',
              message: { role: 'assistant', content: [{ type: 'text', text: 'child answer' }] }
            },
            child
          )
        }
      }
      await settle()
      expect(harness.fetchMock).not.toHaveBeenCalled()

      const root = {
        sessionManager: {
          getSessionId: () => 'legacy-root',
          getSessionFile: () => '/legacy-root.jsonl',
          getHeader: () => ({})
        }
      }
      await harness.callHook('session_start', {}, root)
      await harness.callHook('agent_start', {}, root)
      await settle()
      expect(payloads(harness)).toEqual([
        expect.objectContaining({
          hook_event_name: 'agent_start',
          session_id: 'legacy-root',
          session_file: '/legacy-root.jsonl'
        })
      ])
    }
  )
})

describe('OMP runtime session provenance', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each(['omp', 'pi'] as const)(
    'rejects native children arriving first without parentSession in the %s extension',
    async (kind) => {
      const { harness, root, rootRef } = nativeOwnerHarness(kind, {
        getSessionId: () => 'root',
        getSessionFile: () => '/root.jsonl',
        getHeader: () => ({})
      })
      for (const childKind of ['sub', 'advisor'] as const) {
        const registration = harness.registerTaskChild()
        const child = {
          agent: { id: `Early-${childKind}`, kind: childKind, parentId: 'Main' },
          hasUI: false,
          sessionManager: {
            getSessionId: () => `child-${childKind}`,
            getSessionFile: () => `/child-${childKind}.jsonl`,
            getHeader: () => ({})
          }
        }
        for (const name of [
          'session_start',
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
          'session_shutdown'
        ]) {
          await registration.callHook(
            name,
            {
              type: name,
              reason: 'quit',
              prompt: 'child prompt',
              toolName: 'read',
              input: { path: '/child.txt' },
              args: { path: '/child.txt' },
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'child answer' }]
              }
            },
            child
          )
        }
      }
      await vi.advanceTimersByTimeAsync(1_000)
      expect(harness.fetchMock).not.toHaveBeenCalled()

      try {
        await harness.callHook('session_start', { reason: 'startup' }, root)
        await vi.advanceTimersByTimeAsync(1_000)
        harness.fetchMock.mockClear()
        rootRef.status = 'running'
        rootRef.session.isStreaming = true
        await harness.callHook('agent_start', {}, root)
        await vi.advanceTimersByTimeAsync(0)
        await harness.callHook(
          'message_end',
          { message: { role: 'assistant', content: [{ type: 'text', text: 'root answer' }] } },
          root
        )
        await vi.advanceTimersByTimeAsync(0)
        rootRef.status = 'idle'
        rootRef.session.isStreaming = false
        await harness.callHook('agent_end', {}, root)
        await vi.advanceTimersByTimeAsync(1_000)

        const posts = payloads(harness)
        expect(posts.filter((post) => post.hook_event_name === 'agent_start')).toEqual([
          expect.objectContaining({ session_id: 'root', session_file: '/root.jsonl' })
        ])
        expect(posts.filter((post) => post.hook_event_name === 'message_end')).toEqual([
          expect.objectContaining({ session_id: 'root', text: 'root answer' })
        ])
        expect(posts.filter((post) => post.hook_event_name === 'agent_end')).toEqual([
          expect.objectContaining({ session_id: 'root', session_file: '/root.jsonl' })
        ])
        expect(posts.every((post) => post.session_id === 'root')).toBe(true)
      } finally {
        await harness.callHook('session_shutdown', { reason: 'quit' }, root)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it.each(['fork', 'resume'] as const)(
    'accepts the exact native Main manager with parentSession after %s',
    async (reason) => {
      const { harness, root, rootRef } = nativeOwnerHarness('omp', {
        getSessionId: () => 'resumed-child',
        getSessionFile: () => '/sessions/parent/subagent/child.jsonl',
        getHeader: () => ({ parentSession: '/sessions/parent.jsonl' })
      })

      try {
        await harness.callHook('session_start', { reason }, root)
        await vi.advanceTimersByTimeAsync(1_000)
        rootRef.status = 'running'
        rootRef.session.isStreaming = true
        await harness.callHook('agent_start', {}, root)
        rootRef.status = 'idle'
        rootRef.session.isStreaming = false
        await harness.callHook('agent_end', {}, root)
        await vi.advanceTimersByTimeAsync(1_000)

        const posts = payloads(harness)
        for (const name of ['agent_start', 'agent_end']) {
          expect(posts.filter((post) => post.hook_event_name === name)).toEqual([
            expect.objectContaining({
              session_id: 'resumed-child',
              session_file: '/sessions/parent/subagent/child.jsonl'
            })
          ])
        }
      } finally {
        await harness.callHook('session_shutdown', { reason: 'quit' }, root)
        await vi.advanceTimersByTimeAsync(0)
      }
    }
  )

  it('does not accept a Main label with a different session manager', async () => {
    const manager = {
      getSessionId: () => 'root',
      getSessionFile: () => '/root.jsonl',
      getHeader: () => ({})
    }
    const { harness, root } = nativeOwnerHarness('omp', manager)
    const impostor = { ...root, sessionManager: { ...manager } }
    for (const name of [
      'session_start',
      'agent_start',
      'message_end',
      'agent_end',
      'session_shutdown'
    ]) {
      await harness.callHook(
        name,
        { message: { role: 'assistant', content: [{ type: 'text', text: 'wrong manager' }] } },
        impostor
      )
    }
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.fetchMock).not.toHaveBeenCalled()

    try {
      await harness.callHook('session_start', { reason: 'startup' }, root)
      await harness.callHook('agent_start', {}, root)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(payloads(harness).filter((post) => post.hook_event_name === 'agent_start')).toEqual([
        expect.objectContaining({ session_id: 'root', session_file: '/root.jsonl' })
      ])
    } finally {
      await harness.callHook('session_shutdown', { reason: 'quit' }, root)
      await vi.advanceTimersByTimeAsync(0)
    }
  })
})
