import { stripCodexBrowserGuidance } from '../../shared/agent-browser-guidance'
import { isWslUncPath } from '../../shared/wsl-paths'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import { codexConfigBlocksBrowserGuidance } from './codex-user-developer-instructions'

/** Drops the Codex guidance a builder added when this host cannot prove it would not override user config. */
export async function gateCodexBrowserGuidance(input: {
  command: string | undefined
  connectionId: string | null | undefined
  cwd: string | undefined
  runtime: CodexAccountSelectionTarget['runtime']
  codexHomePaths: readonly (string | null | undefined)[]
}): Promise<string | undefined> {
  const { command, cwd } = input
  if (!command) {
    return command
  }
  const stripped = stripCodexBrowserGuidance(command)
  if (stripped === command) {
    return command
  }
  // Why: only this host's own Codex config is readable here.
  if (input.connectionId || input.runtime === 'wsl' || !cwd || isWslUncPath(cwd)) {
    return stripped
  }
  try {
    return (await codexConfigBlocksBrowserGuidance({
      homePaths: input.codexHomePaths,
      cwd
    }))
      ? stripped
      : command
  } catch {
    return stripped
  }
}
