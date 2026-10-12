import { describe, expect, it } from 'vitest'
import {
  agentSessionOperationKey,
  type AgentSessionOperationRow
} from '../../shared/agent-session-operation-ledger'
import {
  agentSessionOperationStorageKey,
  readableAgentSessionStoreOperationKey
} from './agent-session-store-row-rules'

const ROW: AgentSessionOperationRow = {
  callerKey: 'device-1',
  operationId: '1791730619418-000000000000000000000000000000ee',
  fingerprint: 'fingerprint',
  operationTimestamp: 1_791_730_619_418,
  recordedAt: 1_791_730_619_418,
  expiresAt: 1_791_817_019_418,
  outcome: { status: 'unknown' }
}

describe('agent-session operation storage keys', () => {
  it('uses a NUL-free SQLite key and returns the in-memory key on read', () => {
    const stored = agentSessionOperationStorageKey(ROW)

    expect(stored).not.toContain('\u0000')
    expect(readableAgentSessionStoreOperationKey(stored, ROW)).toBe(
      agentSessionOperationKey(ROW.callerKey, ROW.operationId)
    )
  })

  it('reads legacy keys whether the SQLite binding preserves or truncates the NUL suffix', () => {
    const canonical = agentSessionOperationKey(ROW.callerKey, ROW.operationId)

    expect(readableAgentSessionStoreOperationKey(canonical, ROW)).toBe(canonical)
    expect(readableAgentSessionStoreOperationKey(ROW.callerKey, ROW)).toBe(canonical)
  })

  it('rejects a storage key belonging to another operation', () => {
    expect(readableAgentSessionStoreOperationKey('["device-2","other"]', ROW)).toBeNull()
  })
})
