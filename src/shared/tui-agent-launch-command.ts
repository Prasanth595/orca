import {
  removeOverriddenAgentSessionArgs,
  resolveAgentSessionOptionLaunch
} from './agent-session-option-launch'
import type { SessionOptionValue } from './native-chat-session-options'
import { orcaBrowserGuidanceArgs } from './agent-browser-guidance'
import { agentArgTerminatorIndex } from './agent-session-option-agent-args'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from './tui-agent-config'
import {
  planAgentCliArgsSuffix,
  quoteStartupArg,
  tokenizeStartupCommand,
  type AgentStartupShell
} from './tui-agent-startup-shell'
import type { TuiAgent } from './tui-agent'

export type ResolvedAgentLaunchCommand =
  | {
      ok: true
      command: string
      commandWithoutSessionOptions: string
      appliedSessionOptions: Record<string, SessionOptionValue>
    }
  | { ok: false; error: string }

export type OrcaBrowserGuidanceOptions = {
  /** Advisory Orca-browser guidance for fresh local launches; never part of resume commands. */
  orcaBrowserGuidance?: boolean
  /** Launch spawns through an Orca host whose pty pipeline strips Codex guidance that would override config. */
  codexGuidanceSpawnGated?: boolean
}

export function resolveAgentLaunchCommand(
  args: {
    agent: TuiAgent
    cmdOverrides: Partial<Record<TuiAgent, string>>
    platform: NodeJS.Platform
    shell: AgentStartupShell
    agentArgs?: string | null
    sessionOptions?: Record<string, SessionOptionValue>
    sessionOptionsOverrideAgentArgs?: boolean
    isRemote?: boolean
  } & OrcaBrowserGuidanceOptions
): ResolvedAgentLaunchCommand {
  const override = args.cmdOverrides[args.agent]
  const command =
    override ||
    getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[args.agent], args.platform, {
      isRemote: args.isRemote
    })
  const suffix = planAgentCliArgsSuffix(args.agentArgs, args.shell)
  if (!suffix.ok) {
    return suffix
  }
  const trailingTokens = args.agentArgs?.trim()
    ? tokenizeStartupCommand(args.agentArgs.trim(), args.shell)
    : { ok: true as const, tokens: [], spans: [] }
  if (!trailingTokens.ok) {
    return { ok: false, error: `CLI arguments are invalid: ${trailingTokens.error}` }
  }
  const resolvedOptions = resolveAgentSessionOptionLaunch(
    args.agent,
    args.sessionOptions,
    args.sessionOptionsOverrideAgentArgs ? [] : trailingTokens.tokens,
    !args.sessionOptionsOverrideAgentArgs
  )
  if (override && args.sessionOptionsOverrideAgentArgs) {
    const overrideTokens = tokenizeStartupCommand(override, args.shell)
    if (!overrideTokens.ok) {
      return { ok: false, error: `Agent command override is invalid: ${overrideTokens.error}` }
    }
    const commandOverrideOptions = resolveAgentSessionOptionLaunch(
      args.agent,
      args.sessionOptions,
      overrideTokens.tokens,
      false
    )
    if (
      Object.entries(resolvedOptions.appliedValues).some(
        ([key, value]) => commandOverrideOptions.appliedValues[key] !== value
      )
    ) {
      return {
        ok: false,
        error:
          'Agent command override conflicts with the requested launch preferences. Remove model or effort flags from the command override.'
      }
    }
  }
  const guidanceArgs = resolveGuidanceArgs(args, override, trailingTokens.tokens)
  if (!guidanceArgs.ok) {
    return guidanceArgs
  }
  const launchArgs = [...guidanceArgs.args, ...resolvedOptions.args]
  const optionSuffix = launchArgs.map((arg) => quoteStartupArg(arg, args.shell)).join(' ')
  const commandWithoutSessionOptions = suffix.suffix ? `${command} ${suffix.suffix}` : command
  const commandWithOptions = optionSuffix ? `${command} ${optionSuffix}` : command
  const overrideTokens = args.sessionOptionsOverrideAgentArgs
    ? insertBeforeTerminator(
        args.agent,
        removeOverriddenAgentSessionArgs(args.agent, args.sessionOptions, trailingTokens.tokens),
        launchArgs
      )
    : []
  const commandWithOverrides = overrideTokens.length
    ? `${command} ${overrideTokens.map((token) => quoteStartupArg(token, args.shell)).join(' ')}`
    : command
  return {
    ok: true,
    command: args.sessionOptionsOverrideAgentArgs
      ? commandWithOverrides
      : suffix.suffix
        ? `${commandWithOptions} ${suffix.suffix}`
        : commandWithOptions,
    commandWithoutSessionOptions,
    appliedSessionOptions: resolvedOptions.appliedValues
  }
}

function insertBeforeTerminator(
  agent: TuiAgent,
  tokens: readonly string[],
  inserted: readonly string[]
): string[] {
  const terminator = agentArgTerminatorIndex(agent, tokens)
  return [...tokens.slice(0, terminator), ...inserted, ...tokens.slice(terminator)]
}

function resolveGuidanceArgs(
  args: OrcaBrowserGuidanceOptions & {
    agent: TuiAgent
    shell: AgentStartupShell
    isRemote?: boolean
  },
  override: string | undefined,
  trailingTokens: readonly string[]
): { ok: true; args: string[] } | { ok: false; error: string } {
  if (!args.orcaBrowserGuidance || args.isRemote) {
    return { ok: true, args: [] }
  }
  let overrideTokens: readonly string[] = []
  if (override) {
    const tokenized = tokenizeStartupCommand(override, args.shell)
    if (!tokenized.ok) {
      // Why: guidance is advisory; an unparsable override is reported by its own path, not here.
      return { ok: true, args: [] }
    }
    overrideTokens = tokenized.tokens
  }
  return {
    ok: true,
    args: orcaBrowserGuidanceArgs(args.agent, [...overrideTokens, ...trailingTokens], {
      codexGuidanceSpawnGated: args.codexGuidanceSpawnGated
    })
  }
}
