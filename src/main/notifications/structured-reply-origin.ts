import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import { latestStructuredAgentSessionTurn } from '../../shared/structured-agent-session-live-turn'

/** Uses the host's submission source and exact journal turn, including steered sends. */
export function isStructuredHumanReply(snapshot: AgentJournalSnapshot, turnId: string): boolean {
  if (
    snapshot.items.some(
      (item) => !item.agentId && item.body.kind === 'turn' && item.body.state === 'running'
    )
  ) {
    return false
  }
  const latest = latestStructuredAgentSessionTurn(snapshot.items)
  const turn = snapshot.items.find((item) => !item.agentId && item.itemId === latest?.itemId)
  if (
    !turn ||
    turn.body.kind !== 'turn' ||
    turn.body.turnId !== turnId ||
    turn.body.state !== 'completed' ||
    turn.recovered
  ) {
    return false
  }
  const userItemId = turn.body.userItemId
  return snapshot.submissions.some((submission) => {
    if (
      submission.source?.kind !== 'user' ||
      submission.dispatchState !== 'accepted' ||
      submission.recovered
    ) {
      return false
    }
    const key = agentJournalSubmissionKey(submission.clientMessageId)
    return snapshot.items.some(
      (item) =>
        !item.agentId &&
        (item.itemId === key || item.itemId === submission.providerItemId) &&
        (item.itemId === userItemId ||
          (item.turnScope?.kind === 'turn' && item.turnScope.turnItemId === turn.itemId))
    )
  })
}
