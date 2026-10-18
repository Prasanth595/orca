import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type { AgentSessionJournal } from '../agent-session-journal/journal-store'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store-factory'
import { openTestJournalHostDatabase } from '../agent-session-journal/journal-host-database-test-support'
import { journalIdentityFor } from './structured-agent-session-attach'
import { attachParamsForRecord } from './structured-agent-session-conversation-open'

/** Write through a separate handle after the earlier host has closed the chat. */
export async function writeEarlierProcessJournal(
  root: string,
  record: AgentSessionRecord,
  write: (journal: AgentSessionJournal, fence: number) => Promise<void>
): Promise<void> {
  const params = attachParamsForRecord(record, {
    clientOperationId: 'earlier',
    expectedRuntimeFence: record.lease.runtimeFence
  })
  const journal = await openAgentSessionJournal({
    identity: journalIdentityFor(record, params),
    database: openTestJournalHostDatabase(root)
  })
  await write(journal, record.lease.runtimeFence)
  await journal.close()
}
