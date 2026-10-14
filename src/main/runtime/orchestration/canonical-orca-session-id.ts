import { isOrcaSessionId, type OrcaSessionId } from '../../../shared/orca-session-address'
import {
  clearedInto,
  readAgentSessionRecordStore,
  type AgentSessionRecordReader
} from './structured-session-lineage'

/**
 * The Orca session id orchestration addresses a session by: the first session of its `/clear`
 * lineage, so a cleared chat keeps the address, Runs and mail it had. Every session-to-party step
 * calls this. Without a record store there is no lineage to read, and the id stands for itself.
 */
export function canonicalOrcaSessionId(
  orcaSessionId: OrcaSessionId,
  store: AgentSessionRecordReader | null = readAgentSessionRecordStore()
): OrcaSessionId {
  return buildCanonicalOrcaSessionIdResolver(store)(orcaSessionId)
}

/** Batch readers build the reverse clear index once for their whole snapshot. */
export function buildCanonicalOrcaSessionIdResolver(
  store: AgentSessionRecordReader | null
): (sessionId: OrcaSessionId) => OrcaSessionId {
  if (!store) {
    return (sessionId) => sessionId
  }
  const clearedFrom = new Map<string, string>()
  for (const record of store.listRecords()) {
    const next = clearedInto(record)
    if (next) {
      clearedFrom.set(next, record.sessionId)
    }
  }
  return (orcaSessionId) => {
    // A clear chain is acyclic by construction; the visited set only bounds a corrupt store.
    let root: string = orcaSessionId
    const earlier = new Set([root])
    let prior = clearedFrom.get(root)
    while (prior && !earlier.has(prior)) {
      earlier.add(prior)
      root = prior
      prior = clearedFrom.get(root)
    }
    // Record ids are minted as Orca session ids; one that is not cannot name the conversation.
    return isOrcaSessionId(root) ? root : orcaSessionId
  }
}
