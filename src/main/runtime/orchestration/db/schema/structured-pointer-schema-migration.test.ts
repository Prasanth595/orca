import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from '../../../../sqlite/sync-database'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'
import { SCHEMA_VERSION } from '../contract-constants'

/**
 * A pre-v39 database: the narrow archive CHECK, stamped at 38 so ONLY v39 runs.
 *
 * Seeding lower would still pass while exercising the whole v13->v39 chain instead, which
 * would mask a broken rebuild. `createTables` supplies every other table before migration, so
 * a 38 stamp survives the completeness check and the migration start resolves to 38.
 */
function seedLegacyDatabase(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE worker_terminal_archives (
      dispatch_id   TEXT PRIMARY KEY,
      resource_id   TEXT NOT NULL,
      kind          TEXT NOT NULL CHECK(kind IN ('transcript_pin', 'terminal_tail')),
      content       TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO worker_terminal_archives (dispatch_id, resource_id, kind, content, created_at)
      VALUES ('d_old', 'res_old', 'terminal_tail', '{"lines":["kept"]}', '2026-01-01 00:00:00');
  `)
  db.pragma('user_version = 38')
  db.close()
}

describe('structured pointer schema migration', () => {
  // Why a real temp dir and a teardown: `$TMPDIR` is unset on Windows CI, so the interpolated
  // `/tmp/...` opened as `SQLITE_CANTOPEN`, and nothing removed the file on the platforms where it
  // did open.
  const tempRoots: string[] = []

  afterEach(() => {
    while (tempRoots.length > 0) {
      rmSync(tempRoots.pop() as string, { recursive: true, force: true })
    }
  })

  it('admits the structured archive kind and keeps existing rows', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-structured-migration-'))
    tempRoots.push(root)
    const path = join(root, 'orchestration.db')
    seedLegacyDatabase(path)
    const db = new OrchestrationDb(path)
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      const kept = db.db
        .prepare('SELECT content FROM worker_terminal_archives WHERE dispatch_id = ?')
        .get('d_old') as { content: string }
      expect(kept.content).toContain('kept')
      db.storeWorkerTerminalArchive({
        dispatchId: 'd_new',
        resourceId: 'res_new',
        kind: 'structured_journal',
        content: '{"version":1}'
      })
      expect(db.getWorkerTerminalArchive('d_new')?.kind).toBe('structured_journal')
    } finally {
      db.close()
    }
  })

  it('creates the structured pointer operation store', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      expect(db.getStructuredPointerOperation('dispatch:d1')).toBeUndefined()
      db.putStructuredPointerOperation({
        mailbox_handle: 'dispatch:d1',
        session_id: 's1',
        operation_id: '1757030400000-0123456789abcdef0123456789abcdef',
        batch_fingerprint: 'fp',
        minted_at_ms: 1_757_030_400_000
      })
      expect(db.getStructuredPointerOperation('dispatch:d1')?.operation_id).toBe(
        '1757030400000-0123456789abcdef0123456789abcdef'
      )
      db.deleteStructuredPointerOperation('dispatch:d1')
      expect(db.getStructuredPointerOperation('dispatch:d1')).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('adds the chat-nudge delivery to a v43 database, reading its mail as queued', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-pointer-delivery-migration-'))
    tempRoots.push(root)
    const path = join(root, 'orchestration.db')
    // A current database with the column taken back out and a v43 stamp: ONLY v44 runs.
    const seeded = new OrchestrationDb(path)
    const old = seeded.insertMessage({ from: 'term_coord', to: 'dispatch:d1', subject: 'before' })
    seeded.close()
    const raw = new Database(path)
    raw.exec('ALTER TABLE messages DROP COLUMN pointer_delivery')
    raw.pragma('user_version = 43')
    raw.close()

    const db = new OrchestrationDb(path)
    try {
      expect(db.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      expect(db.getMessageById(old.id)?.pointer_delivery).toBe('queue')
      const steered = db.insertMessage({
        from: 'term_coord',
        to: 'dispatch:d1',
        subject: 'after',
        pointerDelivery: 'now'
      })
      expect(db.getMessageById(steered.id)?.pointer_delivery).toBe('now')
      expect(() =>
        db.db.prepare("UPDATE messages SET pointer_delivery = 'later' WHERE id = ?").run(old.id)
      ).toThrow(/CHECK/)
    } finally {
      db.close()
    }
  })
})
