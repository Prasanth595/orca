import { agentArgValueOptions } from './agent-session-option-agent-args'
import { findOptionOccurrence } from './command-option-occurrence'
import type { TuiAgent } from './tui-agent'

// Why: one ASCII line without shell/TOML metacharacters so it survives posix, PowerShell and cmd quoting.
export const ORCA_BROWSER_AGENT_GUIDANCE =
  'Inside Orca IDE, do all browser work - opening pages, previews, screenshots, UI checks, automation - in the Orca browser via the orca CLI, orca-ide on WSL, not Playwright, Chrome MCP, headless browsers or the system browser. See: orca skills get orca-cli'

const CLAUDE_APPEND_OPTIONS = ['--append-system-prompt', '--append-system-prompt-file']
const CODEX_CONFIG_OPTIONS = ['-c', '--config']
const CODEX_PROFILE_OPTIONS = ['-p', '--profile']
const CODEX_DEVELOPER_INSTRUCTIONS = /^\s*developer_instructions\s*=/

function codexConfigDefinesDeveloperInstructions(tokens: readonly string[]): boolean {
  let rest = tokens
  for (;;) {
    const found = findOptionOccurrence(
      rest,
      CODEX_CONFIG_OPTIONS,
      true,
      agentArgValueOptions('codex')
    )
    if (!found) {
      return false
    }
    if (found.value !== undefined && CODEX_DEVELOPER_INSTRUCTIONS.test(found.value)) {
      return true
    }
    rest = rest.slice(found.index + found.consumed)
  }
}

export function orcaBrowserGuidanceArgs(
  agent: TuiAgent,
  userTokens: readonly string[],
  opts: { codexUserDeveloperInstructions?: boolean } = {}
): string[] {
  if (agent === 'claude') {
    const userAppends = findOptionOccurrence(
      userTokens,
      CLAUDE_APPEND_OPTIONS,
      true,
      agentArgValueOptions(agent)
    )
    return userAppends ? [] : ['--append-system-prompt', ORCA_BROWSER_AGENT_GUIDANCE]
  }
  if (agent === 'codex') {
    // Why: only an explicit `false` proves the user config is clear; a profile flag selects config we cannot resolve here.
    if (
      opts.codexUserDeveloperInstructions !== false ||
      findOptionOccurrence(
        userTokens,
        CODEX_PROFILE_OPTIONS,
        true,
        agentArgValueOptions('codex')
      ) ||
      codexConfigDefinesDeveloperInstructions(userTokens)
    ) {
      return []
    }
    return ['-c', `developer_instructions='${ORCA_BROWSER_AGENT_GUIDANCE}'`]
  }
  return []
}
