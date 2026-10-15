import type { OrchestrationDb } from '../orchestration-db'

/**
 * How a message's nudge reaches a busy chat-mode recipient (`send --deliver`): `queue`, which every
 * earlier message was, or `now`, which steers into the running turn.
 */
export function migrateV44(this: OrchestrationDb, current: number): void {
  if (current >= 44) {
    return
  }
  // Guarded because createTables runs first on every open and already gives a fresh database this.
  if (!this.hasColumn('messages', 'pointer_delivery')) {
    this.db.exec(`
      ALTER TABLE messages ADD COLUMN pointer_delivery TEXT NOT NULL DEFAULT 'queue'
        CHECK(pointer_delivery IN ('queue', 'now'))
    `)
  }
}
