import type Database from '../../sqlite/sync-database'
import { readProfileStateAutomationRunsDocument } from './profile-state-automation-runs'
import {
  assertProfileStateDocumentRevision,
  readProfileStateRevision
} from './profile-state-revision'
import {
  hashProfileStatePayload,
  ProfileStateDocumentCorruptionError,
  validateProfileStateDocumentRow,
  type ProfileStateDocument,
  type ProfileStateParsedDocument,
  type ProfileStateValidatedDocument
} from './profile-state-document-validation'

export type ReadProfileStateDocumentsOptions = {
  /** The profile revision already read by a surrounding snapshot. */
  profileRevision?: number
  /**
   * Skip rows that fail hash/metadata/JSON validation instead of throwing.
   * The remaining intact rows are returned. Used to recover the rest of the
   * profile when a torn write has left one row's content_hash stale.
   */
  salvage?: boolean
}

/**
 * Recompute the stored content_hash for rows whose payload no longer matches
 * it. This is the self-heal that stops a torn write from re-tripping the
 * whole-snapshot validator on the next open: the payload is intact, only the
 * hash went stale, so the row is repaired in place rather than dropped.
 *
 * Returns the number of rows repaired. Rows that fail structural or JSON
 * validation are left untouched (they are the corrupt rows a salvage read
 * skips); scrubbing a bad row would overwrite real data.
 */
export function scrubStaleProfileStateHashes(
  db: Database.Database
): number {
  let repaired = 0
  const rows = db
    .prepare(
      `SELECT domain, payload, domain_version, revision, updated_at, content_hash
       FROM profile_state_documents`
    )
    .iterate()
  for (const row of rows as unknown as Iterable<ProfileStateDocumentRow>) {
    if (!isHashOnlyStale(row)) {
      continue
    }
    const domain = row.domain
    const payload = row.payload
    const domainVersion = row.domain_version
    const revision = row.revision
    const updatedAt = row.updated_at
    db.prepare(
      `UPDATE profile_state_documents
       SET content_hash = ?
       WHERE domain = ? AND domain_version = ? AND revision = ? AND updated_at = ?`
    ).run(hashProfileStatePayload(payload), domain, domainVersion, revision, updatedAt)
    repaired++
  }
  return repaired
}

/** A row is "hash-only stale" when everything but the hash still verifies. */
type ProfileStateDocumentRow = {
  domain: string
  payload: string
  domain_version: number
  revision: number
  updated_at: number
  content_hash: string
}
function isHashOnlyStale(row: unknown): boolean {
  try {
    // The payload must be intact (valid JSON) for a re-hash to be a repair;
    // otherwise a corrupt payload would be blessed with a fresh hash.
    validateProfileStateDocumentRow(row, { validateJson: true })
    return false
  } catch (error) {
    return error instanceof ProfileStateDocumentCorruptionError && error.message.startsWith(
      'Profile state document hash mismatch'
    )
  }
}

/** Read the authoritative rows after checking their hash, shape, and JSON payload. */
export function readProfileStateDocuments(
  db: Database.Database,
  options: ReadProfileStateDocumentsOptions & { representation: 'parsed' }
): readonly ProfileStateParsedDocument[]
export function readProfileStateDocuments(
  db: Database.Database,
  options?: ReadProfileStateDocumentsOptions
): readonly ProfileStateDocument[]
export function readProfileStateDocuments(
  db: Database.Database,
  options: ReadProfileStateDocumentsOptions & { representation: 'validated' }
): void
export function readProfileStateDocuments(
  db: Database.Database,
  options: ReadProfileStateDocumentsOptions & { representation?: 'parsed' | 'validated' } = {}
):
  | readonly (ProfileStateDocument | ProfileStateParsedDocument | ProfileStateValidatedDocument)[]
  | void {
  const profileRevision = options.profileRevision ?? readProfileStateRevision(db)
  let normalized: ReturnType<typeof readProfileStateAutomationRunsDocument>
  try {
    normalized =
      options.representation === 'validated'
        ? readProfileStateAutomationRunsDocument(db, profileRevision, 'validated')
        : options.representation === 'parsed'
          ? readProfileStateAutomationRunsDocument(db, profileRevision, 'parsed')
          : readProfileStateAutomationRunsDocument(db, profileRevision)
  } catch (error) {
    // Salvage mode drops a corrupt normalized automationRuns projection and
    // keeps the rest of the profile; otherwise the caller decides.
    if (options.salvage) {
      normalized = null
    } else {
      throw error
    }
  }
  const rows = db
    .prepare(
      `SELECT domain, payload, domain_version, revision, updated_at, content_hash
       FROM profile_state_documents ORDER BY rowid`
    )
    .iterate()
  const documents: (
    | ProfileStateDocument
    | ProfileStateParsedDocument
    | ProfileStateValidatedDocument
  )[] = []
  for (const row of rows) {
    let document: ReturnType<typeof validateProfileStateDocumentRow>
    try {
      document = validateProfileStateDocumentRow(row, {
        retainParsedValue: options.representation === 'parsed'
      })
      assertProfileStateDocumentRevision(document.revision, profileRevision, document.domain)
      if (
        normalized !== undefined &&
        document.domain === 'automationRuns' &&
        document.payload !== 'null'
      ) {
        throw new ProfileStateDocumentCorruptionError(
          'Normalized automationRuns placeholder is invalid',
          document.domain
        )
      }
    } catch (error) {
      // Salvage mode keeps the surviving rows; a corrupt row is dropped so the
      // rest of the profile still loads instead of quarantining the whole file.
      if (options.salvage) {
        continue
      }
      // Fail-closed otherwise: preserve the original diagnostic unchanged.
      throw error
    }
    if (options.representation === 'validated') {
      continue
    }
    if (options.representation === 'parsed') {
      const { payload: _payload, ...parsedDocument } = document
      documents.push({ ...parsedDocument, value: document.value })
    } else {
      documents.push(document)
    }
  }
  if (options.representation === 'validated') {
    return
  }
  if (normalized === undefined) {
    return documents
  }
  const withoutAutomationRuns = documents.filter((document) => document.domain !== 'automationRuns')
  if (normalized === null) {
    return withoutAutomationRuns
  }
  const originalIndex = documents.findIndex((document) => document.domain === 'automationRuns')
  withoutAutomationRuns.splice(
    originalIndex === -1 ? withoutAutomationRuns.length : originalIndex,
    0,
    normalized
  )
  return withoutAutomationRuns
}
