import { describe, expect, it } from 'vitest'
import type {
  AgentJournalSnapshot,
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import { isStructuredHumanReply } from './structured-reply-origin'

function snapshot(source: 'user' | 'agent' | undefined, steered = false): AgentJournalSnapshot {
  const key = agentJournalSubmissionKey('send')
  const items: AgentJournalRenderItem[] = [
    {
      itemId: 'turn-row',
      revision: 1,
      sequence: 3,
      observedAt: 1,
      body: {
        kind: 'turn',
        turnId: 'turn-A',
        state: 'completed',
        userItemId: steered ? 'program-start' : key
      }
    },
    {
      itemId: key,
      revision: 1,
      sequence: 2,
      observedAt: 1,
      turnScope: { kind: 'turn', turnItemId: 'turn-row' },
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'invented input' }] }
    }
  ]
  const submission: AgentJournalSubmission = {
    clientMessageId: 'send',
    fence: 1,
    payloadFingerprint: 'invented',
    dispatchState: 'accepted',
    providerItemId: 'provider-echo',
    reason: null,
    submittedAt: 1,
    resolvedAt: 1,
    ...(source ? { source: { kind: source } } : {})
  }
  return {
    sessionId: 'session',
    cursor: { epoch: 'epoch', sequence: 3 },
    items,
    submissions: [submission]
  }
}

describe('S8: host journal source and exact completed chat turn', () => {
  it.each([false, true])('accepts a user send, including merged/steered input: %s', (steered) => {
    expect(isStructuredHumanReply(snapshot('user', steered), 'turn-A')).toBe(true)
  })
  it.each(['agent', undefined] as const)('rejects wake and unknown send sources: %s', (source) => {
    expect(isStructuredHumanReply(snapshot(source), 'turn-A')).toBe(false)
  })
  it('does not borrow an unrelated human send, a child, or an old recovered submission', () => {
    const data = snapshot('user')
    expect(isStructuredHumanReply(data, 'turn-B')).toBe(false)
    data.items[0]!.agentId = 'child'
    expect(isStructuredHumanReply(data, 'turn-A')).toBe(false)
    delete data.items[0]!.agentId
    data.submissions[0]!.recovered = true
    expect(isStructuredHumanReply(data, 'turn-A')).toBe(false)
  })
})
