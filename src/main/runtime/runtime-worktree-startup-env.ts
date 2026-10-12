import type { WorktreeStartupLaunch } from '../../shared/worktree/launch-types'

export function mergeStartupEnv(
  startup: WorktreeStartupLaunch | undefined,
  env: Record<string, string> | undefined
): WorktreeStartupLaunch | undefined {
  return startup && env ? { ...startup, env: { ...startup.env, ...env } } : startup
}
