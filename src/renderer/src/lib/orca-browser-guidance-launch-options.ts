import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'

const REFRESH_INTERVAL_MS = 5_000

// Why: builders are synchronous, so the main-process config check is cached; unknown means "skip Codex guidance".
let codexUserDeveloperInstructions: boolean | undefined
let lastRefreshAt = 0

export function refreshCodexUserDeveloperInstructions(now = Date.now()): void {
  if (now - lastRefreshAt < REFRESH_INTERVAL_MS) {
    return
  }
  lastRefreshAt = now
  void window.api.codexConfigSync
    .userDefinesDeveloperInstructions()
    .then((defined) => {
      codexUserDeveloperInstructions = defined
    })
    .catch(() => {
      codexUserDeveloperInstructions = true
    })
}

export function orcaBrowserGuidanceLaunchOptions(
  settings: Pick<GlobalSettings, 'useOrcaBrowserForAgentWork'> | null | undefined,
  agent: TuiAgent
): { orcaBrowserGuidance: boolean; codexUserDeveloperInstructions?: boolean } {
  if (settings?.useOrcaBrowserForAgentWork !== true) {
    return { orcaBrowserGuidance: false }
  }
  if (agent !== 'codex') {
    return { orcaBrowserGuidance: true }
  }
  refreshCodexUserDeveloperInstructions()
  return {
    orcaBrowserGuidance: true,
    codexUserDeveloperInstructions: codexUserDeveloperInstructions ?? true
  }
}

/** Test seam: forgets the cached config check. */
export function resetCodexUserDeveloperInstructionsCache(): void {
  codexUserDeveloperInstructions = undefined
  lastRefreshAt = 0
}
