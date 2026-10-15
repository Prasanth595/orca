import type { TaskProvider } from '../../../src/shared/task-providers'

/** Providers the mobile Tasks screen can list; Plane has no mobile list yet. */
export type MobileTaskProvider = Exclude<TaskProvider, 'plane'>

// Why: a host may report Plane as visible; mobile must not open a tab it cannot load.
export function isMobileSupportedTaskProvider(
  provider: TaskProvider
): provider is MobileTaskProvider {
  return provider !== 'plane'
}
