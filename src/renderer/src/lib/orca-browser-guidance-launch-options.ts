import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { useAppStore } from '@/store'
import { isPairedWebClientWindow } from './desktop-window-chrome'
import { getRuntimeEnvironmentIdForWorktree } from './worktree-runtime-owner'

export function orcaBrowserGuidanceLaunchOptions(
  settings: Pick<GlobalSettings, 'useOrcaBrowserForAgentWork'> | null | undefined,
  agent: TuiAgent,
  worktreeId?: string | null
): { orcaBrowserGuidance: boolean; codexGuidanceSpawnGated?: true } {
  if (settings?.useOrcaBrowserForAgentWork !== true) {
    return { orcaBrowserGuidance: false }
  }
  if (agent !== 'codex') {
    return { orcaBrowserGuidance: true }
  }
  // Why: a paired server may predate the spawn gate, so only this app's own pipelines receive Codex guidance.
  // The paired web client cannot tell which host owns a worktree, so it never gets the flag either.
  if (
    worktreeId &&
    !isPairedWebClientWindow() &&
    getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId) === null
  ) {
    return { orcaBrowserGuidance: true, codexGuidanceSpawnGated: true }
  }
  return { orcaBrowserGuidance: true }
}
