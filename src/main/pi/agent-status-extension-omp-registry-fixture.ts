import {
  createAgentStatusExtensionHarness,
  type HookContext
} from './agent-status-extension-test-harness'

export const NATIVE_TIME = 1_791_947_032_900

type NativeSession = {
  sessionManager: {
    getSessionId: () => string
    getSessionFile: () => string
    getHeader: () => { id: string; parentSession?: string }
  }
  isStreaming: boolean
  hasPendingAsyncWork?: () => boolean
}

export type NativeRef = {
  id: string
  displayName: string
  kind: 'main' | 'sub' | 'advisor'
  parentId?: string
  status: string
  session: NativeSession | null
  sessionFile: string
  createdAt: number
  history?: { agent: string }
  lifecycle?: { acceptedAt?: number; terminalAt?: number }
}

type NativeChange = {
  type: 'registered' | 'status_changed' | 'metadata_changed' | 'removed'
  ref: NativeRef
}

function nativeSession(
  identity: { id: string; file: string; parentSession?: string },
  isStreaming: boolean
): NativeSession {
  return {
    sessionManager: {
      getSessionId: () => identity.id,
      getSessionFile: () => identity.file,
      getHeader: () => ({ id: identity.id, parentSession: identity.parentSession })
    },
    isStreaming
  }
}

export type NativeRoot = {
  ref: NativeRef & { session: NativeSession }
  session: NativeSession
  file: string
  context: HookContext
}

export function nativeRoot(id = 'root-session', isStreaming = false): NativeRoot {
  const file = `/sessions/${id}.jsonl`
  const session = nativeSession({ id, file }, isStreaming)
  return {
    ref: {
      id: 'Main',
      displayName: 'Main',
      kind: 'main',
      status: 'running',
      session,
      sessionFile: file,
      createdAt: NATIVE_TIME - 127
    },
    session,
    file,
    context: {
      agent: { id: 'Main', kind: 'main', depth: 0 },
      sessionManager: session.sessionManager,
      isIdle: () => !session.isStreaming
    }
  }
}

export function nativeChild(id: string, rootFile: string): NativeRef & { session: NativeSession } {
  const sessionFile = `${rootFile.slice(0, -6)}/${id}.jsonl`
  const sessionId = `${id}-session`
  return {
    id,
    displayName: 'registry-proof',
    kind: 'sub',
    parentId: 'Main',
    status: 'running',
    session: nativeSession({ id: sessionId, file: sessionFile, parentSession: rootFile }, true),
    sessionFile,
    createdAt: NATIVE_TIME - 47,
    history: { agent: 'registry-proof' }
  }
}

export function createNativeFixture(
  root: NativeRoot,
  children: NativeRef[],
  options: {
    env: Record<string, string | undefined>
    delivery: (payload: Record<string, unknown>) => Promise<{ ok: boolean }>
  }
) {
  const refs = new Map<string, NativeRef>([root.ref, ...children].map((ref) => [ref.id, ref]))
  const listeners = new Set<(event: NativeChange) => void>()
  let listFailure: Error | undefined
  const registry = {
    list: () => {
      if (listFailure) {
        throw listFailure
      }
      return [...refs.values()]
    },
    get: (id: string) => refs.get(id),
    onChange: (listener: (event: NativeChange) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  const harness = createAgentStatusExtensionHarness({
    kind: 'omp',
    env: options.env,
    nativeExtensionNamespace: { MAIN_AGENT_ID: 'Main', AgentRegistry: { global: () => registry } },
    fetchImpl: async (_url, init) => options.delivery(JSON.parse(String(init?.body)).payload)
  })
  const notify = (type: NativeChange['type'], ref: NativeRef): void => {
    listeners.forEach((listener) => listener({ type, ref }))
  }
  return {
    harness,
    refs,
    notify,
    failList: (error?: Error) => {
      listFailure = error
    },
    setStatus: (ref: NativeRef, status: 'idle' | 'aborted' | 'running') => {
      if (ref.status === 'aborted' || ref.status === status) {
        return
      }
      if (status === 'running') {
        ref.lifecycle = undefined
      } else if (ref.status === 'running') {
        // The SDK stamps terminalAt even for an idle pause with pending async work.
        ref.lifecycle = { ...ref.lifecycle, terminalAt: Date.now() }
      }
      ref.status = status
      if (status === 'aborted') {
        ref.session = null
      } else if (status === 'idle' && ref.session) {
        ref.session.isStreaming = false
      }
      notify('status_changed', ref)
    },
    captureNotification: () => {
      const dispatched = [...listeners]
      return (type: NativeChange['type'], ref: NativeRef) =>
        dispatched.forEach((listener) => listener({ type, ref }))
    }
  }
}
