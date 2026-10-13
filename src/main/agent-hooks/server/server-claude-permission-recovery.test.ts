import { expect, it } from 'vitest'
import type { AgentHookEventPayload } from '../../../shared/agent-hook-listener/listener-event'
import { admitClaudePermissionEvidence } from './server-claude-status-rules'
import type { AgentHookAuthorityEvidence } from './server-types'

const pending: AgentHookEventPayload = {
  paneKey: 'pane',
  source: 'claude',
  connectionId: null,
  restoredUnconfirmed: true,
  hookEventName: 'PermissionRequest',
  toolUseId: 'tool',
  agentPresence: {
    agent: 'claude',
    process: { pid: 4001, platform: 'darwin', startTime: 'birth' }
  },
  providerSession: { key: 'session_id', id: 'session', transcriptPath: '/host/session.jsonl' },
  payload: { state: 'waiting', agentType: 'claude', prompt: '', toolName: 'Bash' }
}
const settled: AgentHookEventPayload = {
  ...pending,
  hookEventName: undefined,
  claudePermissionResolved: true,
  payload: { state: 'working', agentType: 'claude', prompt: '' }
}
const owner: AgentHookAuthorityEvidence = {
  paneKey: 'pane',
  connectionId: null,
  launchTokenHash: 'saved-hash',
  observedAt: 1
}

it('requires the current in-process baseline in addition to restored proof fields', () => {
  const revoked = new WeakSet<AgentHookAuthorityEvidence>()
  expect(admitClaudePermissionEvidence(pending, settled, [owner], revoked)).toBeUndefined()
  expect(
    admitClaudePermissionEvidence(pending, settled, [owner], revoked, { ...pending })
  ).toBeUndefined()
  expect(admitClaudePermissionEvidence(pending, settled, [owner], revoked, pending)).toBe(settled)
  expect(
    admitClaudePermissionEvidence({ ...pending }, settled, [owner], revoked, pending)
  ).toBeUndefined()
})

it('rejects missing, foreign and revoked frozen ownership', () => {
  const revoked = new WeakSet<AgentHookAuthorityEvidence>()
  for (const owners of [
    [],
    [{ ...owner, paneKey: 'other' }],
    [{ ...owner, connectionId: 'remote' }],
    [{ ...owner, launchTokenHash: '' }]
  ]) {
    expect(
      admitClaudePermissionEvidence(pending, settled, owners, revoked, pending)
    ).toBeUndefined()
  }
  revoked.add(owner)
  expect(admitClaudePermissionEvidence(pending, settled, [owner], revoked, pending)).toBeUndefined()
})

it.each([
  { connectionId: 'remote' },
  { launchToken: 'new-owner' },
  { toolUseId: 'other' },
  { toolAgentId: 'child' },
  { toolAgentType: 'worker' },
  { restoredUnconfirmed: undefined },
  {
    providerSession: {
      key: 'session_id' as const,
      id: 'other',
      transcriptPath: '/host/session.jsonl'
    }
  },
  {
    agentPresence: {
      agent: 'claude',
      process: { pid: 4001, platform: 'darwin' as const, startTime: 'new-birth' }
    }
  }
])('rejects a changed identity even with the current baseline: %j', (change) => {
  expect(
    admitClaudePermissionEvidence(
      pending,
      { ...settled, ...change },
      [owner],
      new WeakSet(),
      pending
    )
  ).toBeUndefined()
})
