import { agentArgValueOptions } from './agent-session-option-agent-args'
import { findOptionOccurrence } from './command-option-occurrence'
import type { TuiAgent } from './tui-agent'
import { quoteStartupArg } from './tui-agent-startup-shell'
import type { AgentStartupShell } from './tui-agent-startup-shell'

// Why: one ASCII line without shell/TOML metacharacters so it survives posix, PowerShell and cmd quoting.
export const ORCA_BROWSER_AGENT_GUIDANCE =
  'Inside Orca IDE, do all browser work - opening pages, previews, screenshots, UI checks, automation - in the Orca browser via the orca CLI, orca-ide on WSL, not Playwright, Chrome MCP, headless browsers or the system browser. See: orca skills get orca-cli'

const CODEX_GUIDANCE_ARGS = [
  '-c',
  `developer_instructions='${ORCA_BROWSER_AGENT_GUIDANCE}'`
] as const
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
  opts: { codexGuidanceSpawnGated?: boolean } = {}
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
    // Why: the executing host's spawn gate verifies Codex config; unset means the launch may not reach one.
    if (
      opts.codexGuidanceSpawnGated !== true ||
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
    return [...CODEX_GUIDANCE_ARGS]
  }
  return []
}

const STARTUP_SHELLS: readonly AgentStartupShell[] = ['posix', 'powershell', 'cmd']

/** Removes the Codex guidance fragment a builder added; any other command is returned unchanged. */
export function stripCodexBrowserGuidance(command: string): string {
  for (const shell of STARTUP_SHELLS) {
    const fragment = ` ${CODEX_GUIDANCE_ARGS.map((arg) => quoteStartupArg(arg, shell)).join(' ')}`
    const index = command.indexOf(fragment)
    if (index !== -1) {
      return command.slice(0, index) + command.slice(index + fragment.length)
    }
  }
  return command
}
