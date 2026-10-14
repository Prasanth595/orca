import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { AgentStatusOrchestrationContext } from '../../shared/agent-status-types'
import { isOrcaSessionId, parseOrcaSessionAddress } from '../../shared/orca-session-address'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import { buildCanonicalOrcaSessionIdResolver } from './orchestration/canonical-orca-session-id'
import { parsePaneKey } from '../../shared/stable-pane-id'
import type { OrchestrationDb } from './orchestration/db'
import type { RunRow } from './orchestration/types'
import { currentRunCoordinatorOrcaSessionId } from './orchestration/db/runs/run-coordinator-orca-session'
import {
  readAgentSessionRecordStore,
  resolveLineageRunningSession
} from './orchestration/structured-session-lineage'
import {
  resolveStructuredWorkerIdentity,
  resolveStructuredWorkerIdentityForRoot
} from './structured-worker-authority'

/** Display panes are public, deterministic identities; never use them as mailbox authority. */
function sessionDisplayPane(sessionId: string): string | null {
  const store = readAgentSessionRecordStore()
  const running = store ? resolveLineageRunningSession(store, sessionId) : null
  if (running && running.kind !== 'here') {
    return null
  }
  const displayedSession = running?.sessionId ?? sessionId
  return structuredAgentSessionPaneKey(
    structuredAgentSessionTabId(displayedSession),
    displayedSession
  )
}

export function createStructuredStatusWorkerBinding(db: OrchestrationDb) {
  let canonicalSessionId: ReturnType<typeof buildCanonicalOrcaSessionIdResolver> | undefined
  return (row: AgentStatusIpcPayload) => {
    if (!row.structuredHost || row.connectionId !== null) {
      return null
    }
    const tabId = parsePaneKey(row.paneKey)?.tabId
    const prefix = 'structured-agent-session-'
    if (!tabId?.startsWith(prefix)) {
      return null
    }
    const sessionId = tabId.slice(prefix.length)
    if (row.paneKey !== structuredAgentSessionPaneKey(tabId, sessionId)) {
      return null
    }
    let identity = resolveStructuredWorkerIdentityForRoot(sessionId, db)
    if (!identity && isOrcaSessionId(sessionId)) {
      canonicalSessionId ??= buildCanonicalOrcaSessionIdResolver(readAgentSessionRecordStore())
      const root = canonicalSessionId(sessionId)
      if (root !== sessionId) {
        identity = resolveStructuredWorkerIdentityForRoot(root, db)
      }
    }
    return identity && identity.worktreeId === row.worktreeId && identity.hostScope.kind === 'local'
      ? { handle: identity.handle, authorityPaneKey: identity.paneKey, displayPaneKey: row.paneKey }
      : null
  }
}

export function projectStructuredOrchestrationDisplay(
  context: AgentStatusOrchestrationContext,
  db: OrchestrationDb | null,
  run: RunRow | undefined,
  paneKey: string | undefined,
  creatorSessionId?: string | null
): AgentStatusOrchestrationContext {
  const parentHandle =
    context.parentTerminalHandle ?? context.coordinatorHandle ?? run?.coordinator_handle
  const identity = parentHandle ? resolveStructuredWorkerIdentity(parentHandle, db) : null
  if (
    context.parentTerminalHandle &&
    !identity &&
    !parseOrcaSessionAddress(context.parentTerminalHandle)
  ) {
    return context
  }
  if (context.parentPaneKey && !identity && !creatorSessionId) {
    return context
  }
  const parentSession =
    creatorSessionId ??
    identity?.sessionId ??
    (parentHandle ? parseOrcaSessionAddress(parentHandle) : null) ??
    (run ? currentRunCoordinatorOrcaSessionId(run) : null)
  if (!parentSession) {
    return context
  }
  const displayPaneKey = sessionDisplayPane(parentSession)
  const self = paneKey === displayPaneKey || (identity !== null && paneKey === identity.paneKey)
  const {
    parentPaneKey: _parentPane,
    parentTerminalHandle: _parentHandle,
    coordinatorHandle: _coordinator,
    ...rest
  } = context
  return {
    ...rest,
    ...(displayPaneKey && !self ? { parentPaneKey: displayPaneKey } : {})
  }
}
