import { MANAGED_HOOK_TIMEOUT_SECONDS } from '../agent-hooks/installer-utils'

export function resolveCodexHookTimeoutSeconds(
  platform: NodeJS.Platform,
  configured: string | undefined
): number {
  return platform === 'win32' && configured === '30' ? 30 : MANAGED_HOOK_TIMEOUT_SECONDS
}

// Why fixed at startup: hook files, hash derivation and trust caches must use the same budget.
export const CODEX_MANAGED_HOOK_TIMEOUT_SECONDS = resolveCodexHookTimeoutSeconds(
  process.platform,
  process.env.ORCA_CODEX_HOOK_TIMEOUT_SECONDS
)
