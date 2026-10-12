/**
 * What makes one agent-session store row readable. A load applies these to every row it reads; a
 * transaction applies them to every row it changed before committing, so the rows this build writes
 * are exactly the rows a later load accepts.
 */

import {
  agentSessionOperationKey,
  isAgentSessionOperationRow,
  type AgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import { isAgentSessionId, isPersistedAgentSessionRecord } from '../../shared/agent-session-record'
import type { PersistedAgentSessionRecord } from '../../shared/agent-session-legacy-handoff-lease'
import { isAgentSessionSurfaceTabId } from '../../shared/agent-session-surface-tab-id'
import type { RetiredAgentSessionClaimKey } from './agent-session-store-state'
import type { PersistedAgentSessionTab } from './agent-session-tab-table'

/** Valid stored identity, independent of provider availability. */
export function isReadableAgentSessionStoreRecord(
  sessionId: string,
  value: unknown
): value is PersistedAgentSessionRecord {
  return isPersistedAgentSessionRecord(value) && value.sessionId === sessionId
}

export function isReadableAgentSessionStoreOperation(
  key: string,
  value: unknown
): value is AgentSessionOperationRow {
  return readableAgentSessionStoreOperationKey(key, value) !== null
}

/** NUL-delimited keys stay in memory; the current SQLite row gets JSON text that Node round-trips. */
export function agentSessionOperationStorageKey(
  value: Pick<AgentSessionOperationRow, 'callerKey' | 'operationId'>
): string {
  return JSON.stringify([value.callerKey, value.operationId])
}

/** Canonicalizes current storage plus legacy full and Node-24-truncated NUL keys. */
export function readableAgentSessionStoreOperationKey(key: string, value: unknown): string | null {
  if (!isAgentSessionOperationRow(value)) {
    return null
  }
  const canonical = agentSessionOperationKey(value.callerKey, value.operationId)
  return key === agentSessionOperationStorageKey(value) ||
    key === canonical ||
    key === value.callerKey
    ? canonical
    : null
}

export function isReadableRetiredAgentSessionClaimKey(
  entry: unknown
): entry is RetiredAgentSessionClaimKey {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'keyId' in entry &&
    typeof entry.keyId === 'string' &&
    entry.keyId.length > 0 &&
    entry.keyId.length <= 512 &&
    'retiredAt' in entry &&
    typeof entry.retiredAt === 'number' &&
    Number.isSafeInteger(entry.retiredAt) &&
    entry.retiredAt >= 0
  )
}

/** One chat tab entry; a table is readable when every entry is and no id repeats. */
export function isReadableAgentSessionStoreTab(entry: unknown): entry is PersistedAgentSessionTab {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'tabId' in entry &&
    isAgentSessionSurfaceTabId(entry.tabId) &&
    'sessionId' in entry &&
    isAgentSessionId(entry.sessionId)
  )
}
