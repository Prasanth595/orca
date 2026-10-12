import type { OrchestrationDb } from '../orchestration-db'

export function migrateV44(this: OrchestrationDb, current: number): void {
  if (current < 44 && !this.hasColumn('runs', 'notification_policy')) {
    this.db.exec("ALTER TABLE runs ADD COLUMN notification_policy TEXT NOT NULL DEFAULT 'all'")
  }
}
