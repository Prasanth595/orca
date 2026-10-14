import { buildLegacyAgentChildRowModels } from '../../shared/agent-child-row-model'
import {
  isFreshNonDoneAgentStatus,
  type AgentStatusState,
  type AgentSubagentSnapshot
} from '../../shared/agent-status-types'
import {
  createAgentStatusExtensionHarness,
  type AgentStatusExtensionHarness,
  type HookContext
} from './agent-status-extension-test-harness'

type PostedOmpPayload = {
  hook_event_name: string
  session_id?: string
  session_file?: string
  session_boundary?: true
  omp_status?: {
    state: AgentStatusState
    session_boundary?: true
    prompt?: string
    tool_name?: string
    tool_input?: unknown
    role?: 'assistant'
    text?: string
  }
  subagents?: AgentSubagentSnapshot[]
}

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
  lastActivity: number
  history?: { agent: string; resolvedModel: string }
  lifecycle?: { acceptedAt?: number; terminalAt?: number }
}

type NativeAttachedRef = NativeRef & { session: NativeSession }

type NativeChange = {
  type: 'registered' | 'status_changed' | 'metadata_changed' | 'removed'
  ref: NativeRef
}

export type NativeRoot = {
  ref: NativeAttachedRef
  session: NativeSession
  file: string
  context: HookContext
  replaceSession: (id: string, parentSession?: string, sessionFile?: string) => void
}

function nativeSession(
  id: string,
  file: string,
  isStreaming: boolean,
  parentSession?: string
): NativeSession {
  return {
    sessionManager: {
      getSessionId: () => id,
      getSessionFile: () => file,
      getHeader: () => ({ id, parentSession })
    },
    isStreaming
  }
}

export function nativeRoot(id = 'root-session', isStreaming = false): NativeRoot {
  const identity: { id: string; file: string; parentSession: string | undefined } = {
    id,
    file: `/sessions/${id}.jsonl`,
    parentSession: undefined
  }
  const session: NativeSession = {
    sessionManager: {
      getSessionId: () => identity.id,
      getSessionFile: () => identity.file,
      getHeader: () => ({ id: identity.id, parentSession: identity.parentSession })
    },
    isStreaming
  }
  const ref: NativeAttachedRef = {
    id: 'Main',
    displayName: 'Main',
    kind: 'main',
    status: 'running',
    session,
    sessionFile: identity.file,
    createdAt: NATIVE_TIME - 127,
    lastActivity: NATIVE_TIME - 120
  }
  return {
    ref,
    session,
    get file() {
      return identity.file
    },
    context: {
      agent: { id: 'Main', kind: 'main', depth: 0 },
      sessionManager: session.sessionManager,
      isIdle: () => !session.isStreaming
    },
    replaceSession(nextId, parentSession, sessionFile) {
      identity.id = nextId
      identity.file = sessionFile ?? `/sessions/${nextId}.jsonl`
      identity.parentSession = parentSession
      ref.sessionFile = identity.file
      session.isStreaming = false
    }
  }
}

export function nativeChild(
  id: string,
  rootFile: string,
  createdAt = NATIVE_TIME - 47,
  sessionId = `${id}-session`
): NativeAttachedRef {
  const sessionFile = `${rootFile.slice(0, -6)}/${id}.jsonl`
  return {
    id,
    // Native displayName can repeat a role; task identity remains the native ID.
    displayName: 'registry-proof',
    kind: 'sub' as const,
    parentId: 'Main',
    status: 'running',
    session: nativeSession(sessionId, sessionFile, true, rootFile),
    sessionFile,
    createdAt,
    lastActivity: createdAt + 3,
    history: { agent: 'registry-proof', resolvedModel: 'orca-registry-proof/child' }
  }
}

type DeliveredPost = { payload: PostedOmpPayload; observedAt: number }
export type NativeDeliveryResponse = { ok: boolean; status?: number }

type NativeFixture = {
  harness: AgentStatusExtensionHarness
  refs: Map<string, NativeRef>
  delivered: DeliveredPost[]
  accepted: DeliveredPost[]
  notify: (type: NativeChange['type'], ref: NativeRef) => void
  failList: (error?: Error) => void
  setStatus: (ref: NativeRef, status: 'idle' | 'aborted' | 'running') => void
  captureNotification: () => (type: NativeChange['type'], ref: NativeRef) => void
}

export function createNativeFixture(
  root: NativeRoot,
  children: NativeRef[],
  options: {
    runtime?: { kind: 'omp' | 'pi'; title?: string; argv?: readonly string[] }
    registryAvailable?: boolean
    env?: Record<string, string | undefined>
    delivery?: (payload: PostedOmpPayload) => Promise<NativeDeliveryResponse>
  } = {}
): NativeFixture {
  const refs = new Map<string, NativeRef>([root.ref, ...children].map((ref) => [ref.id, ref]))
  const listeners = new Set<(event: NativeChange) => void>()
  const delivered: DeliveredPost[] = []
  const accepted: DeliveredPost[] = []
  let listFailure: Error | undefined
  // Fake only the native boundary. Production reads these same mutable AgentRefs.
  const registry = {
    list: () => {
      if (listFailure) {
        throw listFailure
      }
      return [...refs.values()]
    },
    get: (id: string) => refs.get(id),
    isRunning: (ref: NativeRef) => ref.status === 'running' && ref.session?.isStreaming === true,
    onChange: (listener: (event: NativeChange) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  const harness = createAgentStatusExtensionHarness({
    ...(options.runtime ?? { kind: 'omp' }),
    env: options.env,
    ...(options.registryAvailable === false
      ? {}
      : {
          nativeExtensionNamespace: {
            MAIN_AGENT_ID: 'Main',
            AgentRegistry: { global: () => registry }
          }
        }),
    fetchImpl: async (_url, init) => {
      const body: { payload: PostedOmpPayload } = JSON.parse(String(init?.body))
      delivered.push({ payload: body.payload, observedAt: Date.now() })
      const response = await (options.delivery?.(body.payload) ?? { ok: true })
      if (response.ok) {
        accepted.push({ payload: body.payload, observedAt: Date.now() })
      }
      return response
    }
  })
  const notify = (type: NativeChange['type'], ref: NativeRef): void => {
    for (const listener of listeners) {
      listener({ type, ref })
    }
  }
  return {
    harness,
    refs,
    delivered,
    accepted,
    notify,
    failList: (error) => {
      listFailure = error
    },
    setStatus: (ref, status) => {
      if (ref.status === 'aborted' || ref.status === status) {
        return
      }
      ref.lastActivity = Date.now()
      if (status === 'running') {
        ref.lifecycle = undefined
      } else if (ref.status === 'running') {
        ref.lifecycle = { ...ref.lifecycle, terminalAt: ref.lastActivity }
      }
      ref.status = status
      if (status === 'aborted') {
        ref.session = null
      } else if (status === 'idle' && ref.session) {
        ref.session.isStreaming = false
      }
      notify('status_changed', ref)
    },
    // A callback can already be dispatched before its subscription is retired.
    captureNotification: () => {
      const dispatched = [...listeners]
      return (type, ref) => {
        for (const listener of dispatched) {
          listener({ type, ref })
        }
      }
    }
  }
}

export function latestSnapshot(fixture: NativeFixture): DeliveredPost {
  const post = fixture.delivered.findLast(
    ({ payload }) => payload.hook_event_name === 'subagents_update'
  )
  if (!post) {
    throw new Error('Expected a native subagents_update snapshot')
  }
  return post
}

export function latestPost(fixture: NativeFixture): DeliveredPost {
  const post = fixture.delivered.at(-1)
  if (!post) {
    throw new Error('Expected a delivered status post')
  }
  return post
}

export function childIds(payload: PostedOmpPayload): string[] {
  return (payload.subagents ?? []).map(({ id }) => id).sort()
}

export function postedPayloads(harness: AgentStatusExtensionHarness): PostedOmpPayload[] {
  return harness.fetchMock.mock.calls.map((call) => {
    const body: { payload: PostedOmpPayload } = JSON.parse(String(call[1]?.body))
    return body.payload
  })
}

export function childRows(
  payload: PostedOmpPayload | undefined,
  observedAt = Date.now(),
  now = Date.now()
) {
  return buildLegacyAgentChildRowModels(payload?.subagents ?? [], {
    parentEvidenceFresh: isFreshNonDoneAgentStatus(
      { state: 'working', updatedAt: observedAt },
      now
    ),
    transportObservation: 'live',
    parentObservedAt: observedAt,
    hostClockOffsetMs: 0
  })
}
