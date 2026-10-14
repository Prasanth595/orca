import {
  ORCA_BROWSER_AGENT_GUIDANCE,
  stripCodexBrowserGuidance
} from '../../shared/agent-browser-guidance'
import {
  quotePosixArg,
  resolveSetupAgentSequenceLaunchCommand,
  SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV,
  SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV
} from '../../shared/setup-agent-sequencing'
import { isWslUncPath } from '../../shared/wsl-paths'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import { codexConfigBlocksBrowserGuidance } from './codex-user-developer-instructions'

const SCRIPT_FAIL_CLOSED = `echo ${quotePosixArg('Orca could not start the agent without its browser guidance; relaunch it.')} >&2; exit 1`

/** Setup-sequenced launches run the agent from env, so the guidance is stripped there too. */
export function stripSequencedCodexBrowserGuidance(
  env: Record<string, string> | undefined
): Record<string, string> | undefined {
  const sequenced = env?.[SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]
  const script = env?.[SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV]
  if (!env || (sequenced === undefined && script === undefined)) {
    return env
  }
  const next: Record<string, string> = { ...env }
  let strippedScript = script
  if (sequenced !== undefined) {
    const strippedCommand = stripCodexBrowserGuidance(sequenced)
    next[SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV] = strippedCommand
    if (script !== undefined && strippedCommand !== sequenced) {
      // Why: the script embeds the command verbatim or re-quoted (env-prefixed or chained commands).
      strippedScript = script
        .split(quotePosixArg(sequenced))
        .join(quotePosixArg(strippedCommand))
        .split(sequenced)
        .join(strippedCommand)
    }
  }
  if (strippedScript !== undefined) {
    next[SETUP_AGENT_SEQUENCE_STARTUP_SCRIPT_ENV] = strippedScript.includes(
      ORCA_BROWSER_AGENT_GUIDANCE
    )
      ? SCRIPT_FAIL_CLOSED
      : strippedScript
  }
  return next
}

/** Drops the Codex guidance a builder added when this host cannot prove it would not override user config. */
export async function gateCodexBrowserGuidance(input: {
  command: string | undefined
  env: Record<string, string> | undefined
  connectionId: string | null | undefined
  cwd: string | undefined
  runtime: CodexAccountSelectionTarget['runtime']
  codexHomePaths: readonly (string | null | undefined)[]
}): Promise<{ command: string | undefined; env: Record<string, string> | undefined }> {
  const { command, env, cwd } = input
  const kept = { command, env }
  const checked = resolveSetupAgentSequenceLaunchCommand(env ?? {}, command)
  const strippedEnv = stripSequencedCodexBrowserGuidance(env)
  const strippedCommand = command ? stripCodexBrowserGuidance(command) : command
  const hasFragment =
    (checked !== undefined && stripCodexBrowserGuidance(checked) !== checked) ||
    strippedCommand !== command ||
    Object.entries(strippedEnv ?? {}).some(([key, value]) => env?.[key] !== value)
  if (!hasFragment) {
    return kept
  }
  const stripped = { command: strippedCommand, env: strippedEnv }
  // Why: only this host's own Codex config is readable here.
  if (input.connectionId || input.runtime === 'wsl' || !cwd || isWslUncPath(cwd)) {
    return stripped
  }
  try {
    return (await codexConfigBlocksBrowserGuidance({ homePaths: input.codexHomePaths, cwd }))
      ? stripped
      : kept
  } catch {
    return stripped
  }
}
