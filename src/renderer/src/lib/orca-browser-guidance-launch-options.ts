import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'

const REFRESH_INTERVAL_MS = 5_000

// Why: builders are synchronous, so the main-process config check is cached per launch cwd;
// unknown means "skip Codex guidance".
const codexConfigAnswers = new Map<string, boolean>()
const lastRefreshAt = new Map<string, number>()

export function refreshCodexUserDeveloperInstructions(cwd?: string, now = Date.now()): void {
  const key = cwd ?? ''
  if (now - (lastRefreshAt.get(key) ?? -Infinity) < REFRESH_INTERVAL_MS) {
    return
  }
  lastRefreshAt.set(key, now)
  void window.api.codexConfigSync
    .userDefinesDeveloperInstructions(cwd)
    .then((defined) => {
      codexConfigAnswers.set(key, defined)
    })
    .catch(() => {
      codexConfigAnswers.set(key, true)
    })
}

export function orcaBrowserGuidanceLaunchOptions(
  settings: Pick<GlobalSettings, 'useOrcaBrowserForAgentWork'> | null | undefined,
  agent: TuiAgent,
  cwd?: string | null
): { orcaBrowserGuidance: boolean; codexUserDeveloperInstructions?: boolean } {
  if (settings?.useOrcaBrowserForAgentWork !== true) {
    return { orcaBrowserGuidance: false }
  }
  if (agent !== 'codex') {
    return { orcaBrowserGuidance: true }
  }
  const launchCwd = cwd?.trim() || undefined
  // Why: without a cwd we cannot see project .codex/config.toml, which -c would override.
  if (!launchCwd) {
    return { orcaBrowserGuidance: true, codexUserDeveloperInstructions: true }
  }
  refreshCodexUserDeveloperInstructions(launchCwd)
  return {
    orcaBrowserGuidance: true,
    codexUserDeveloperInstructions: codexConfigAnswers.get(launchCwd) ?? true
  }
}

/** Test seam: forgets the cached config checks. */
export function resetCodexUserDeveloperInstructionsCache(): void {
  codexConfigAnswers.clear()
  lastRefreshAt.clear()
}
