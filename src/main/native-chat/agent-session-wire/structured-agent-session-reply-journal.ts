import type { AgentJournalSnapshot } from '../../../shared/agent-session-journal-types'
import type { StructuredAgentSessionHostSession } from './structured-agent-session-host-types'

export function createStructuredReplyJournal(
  sessions: ReadonlyMap<string, StructuredAgentSessionHostSession>
) {
  return {
    cursors: () => new Map([...sessions].map(([id, session]) => [id, session.journal.cursor()])),
    snapshot: (sessionId: string): AgentJournalSnapshot | null => {
      const journal = sessions.get(sessionId)?.journal
      if (!journal) {
        return null
      }
      const snapshot = journal.snapshot()
      return {
        ...snapshot,
        submissions: snapshot.submissions.filter(
          (submission) =>
            submission.submittedSequence !== undefined &&
            !journal.wroteBeforeOpen(submission.submittedSequence)
        )
      }
    }
  }
}
