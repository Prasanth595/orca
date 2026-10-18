import { AUTOMATION_RUNS_DOMAIN } from './profile-state-automation-runs-model'
import { openProfileStateDatabaseReadOnly } from './profile-state-database'
import { readProfileStateRevision } from './profile-state-revision'
import {
  parseProfileStateRoot,
  validateProfileStateDocumentRow,
  type ProfileStateDocument
} from './profile-state-document-validation'
import type { SqliteRow } from '../../sqlite/sqlite-statement'

export type SalvageDocumentSource = {
  databasePath: string
  profileId: string
  /** Keep only these domains when set. */
  domains?: readonly string[]
}

export type SalvageResult = {
  /** Documents whose stored hash and metadata verify. */
  intactDocuments: readonly ProfileStateDocument[]
  /**
   * Documents dropped because they reference normalized storage (automation
   * runs kept in projection tables) whose rows are not verifiable byte-for-byte
   * by a hash check.
   */
  droppedProjectionDomains: readonly string[]
  /**
   * Domains whose row failed validation and were skipped: a hash mismatch, a
   * payload that is not a valid state root, or a revision that leads the source
   * profile revision (which cannot pass the strict fence after the merge).
   */
  skippedDomains: readonly string[]
  /** The salvaged database's own profile revision, if readable. */
  sourceRevision: number
}

/**
 * Recover the individually intact documents from a profile-state database that
 * fails whole-snapshot validation.
 *
 * Whole-snapshot readers fail closed on the first corrupt row, so a crash or
 * torn write that leaves one document's `content_hash` stale blocks recovery of
 * every other document in the file. This reads the rows one at a time and keeps
 * only the ones whose hash and metadata still verify, so a caller can merge
 * them into a clean baseline and recover the lost revisions.
 */
export function salvageValidDocuments(options: SalvageDocumentSource): SalvageResult {
  const opened = openProfileStateDatabaseReadOnly(options.databasePath, options.profileId)
  try {
    const sourceRevision = readProfileStateRevision(opened.db)
    const wanted = options.domains !== undefined ? new Set(options.domains) : undefined
    const intactDocuments: ProfileStateDocument[] = []
    const droppedProjectionDomains: string[] = []
    const skippedDomains: string[] = []
    for (const row of opened.db
      .prepare(
        `SELECT domain, payload, domain_version, revision, updated_at, content_hash
         FROM profile_state_documents ORDER BY rowid`
      )
      .iterate() as unknown as Iterable<SqliteRow>) {
      const domain = row.domain
      if (wanted !== undefined && (typeof domain !== 'string' || !wanted.has(domain))) {
        continue
      }
      let document: ProfileStateDocument
      try {
        // Validate hash and metadata, then the payload itself: a row that is
        // intact bytes but not a valid state root would poison the next strict
        // read of the restored baseline, so only well-formed roots are kept.
        document = validateProfileStateDocumentRow(row, { validateJson: false })
        parseProfileStateRoot(document.payload)
        if (domain === AUTOMATION_RUNS_DOMAIN) {
          // Normalized automation runs live in projection tables whose aggregate
          // hash this row cannot verify byte-for-byte; a document-row-only merge
          // would orphan the restored baseline. Drop the domain and let the
          // caller recover it from a trusted snapshot.
          droppedProjectionDomains.push(domain)
          continue
        }
        // A revision above the source's profile revision cannot pass the strict
        // document-revision fence after the merge raises the floor to the source
        // revision, so skip it rather than poison the restored baseline.
        if (document.revision > sourceRevision) {
          skippedDomains.push(document.domain)
          continue
        }
      } catch {
        if (typeof domain === 'string') {
          skippedDomains.push(domain)
        }
        continue
      }
      intactDocuments.push(document)
    }
    if (skippedDomains.length > 0) {
      console.warn(
        '[persistence] Salvaged profile state documents; dropped corrupt entries:',
        skippedDomains.join(', ')
      )
    }
    if (droppedProjectionDomains.length > 0) {
      console.warn(
        '[persistence] Salvage excluded normalized domains (recover from a trusted snapshot):',
        droppedProjectionDomains.join(', ')
      )
    }
    return {
      intactDocuments,
      droppedProjectionDomains,
      skippedDomains,
      sourceRevision
    }
  } finally {
    opened.db.close()
  }
}
