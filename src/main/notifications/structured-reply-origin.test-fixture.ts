import type {
  AgentJournalSnapshot,
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'

export function replySnapshotFixture(
  source: 'user' | 'agent' | undefined,
  steered = false
): AgentJournalSnapshot {
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
    submittedSequence: 2,
    ...(source ? { source: { kind: source } } : {})
  }
  return {
    sessionId: 'session',
    cursor: { epoch: 'epoch', sequence: 3 },
    items,
    submissions: [submission]
  }
}
