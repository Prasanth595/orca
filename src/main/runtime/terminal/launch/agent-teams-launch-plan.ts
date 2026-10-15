import type { RuntimePtyController } from '../../runtime-pty-controller-contract'
import {
  addClaudeTeammateModeAuto,
  addClaudeTeammateModeInProcess,
  type ClaudeAgentTeamsMode
} from '../../../../shared/claude-agent-teams-tmux-compat'
import type { AgentStartupShell } from '../../../../shared/tui-agent-startup-shell'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import type { TerminalCreateOptions } from '../../runtime-terminal-contracts'
import { buildClaudeAgentTeamsLaunchPlan } from '../../claude-agent-teams-shim-env'
import { inferCapturedClaudeAgentTeamsMode } from '../../runtime-agent-launch-resolution'

type AdoptedBeforeLaunch =
  | boolean
  | Awaited<ReturnType<NonNullable<RuntimePtyController['adoptStablePane']>>>
  | undefined

/**
 * Resolves the pane shell and launch plan for a background terminal create, releasing the
 * caller's claimed stable-pane-create slot on failure so the claim never leaks past this step.
 */
export async function resolveAgentTeamsLaunchPlanForTerminalCreate(args: {
  store:
    | {
        getSettings?: () => {
          terminalWindowsShell?: string | null
          claudeAgentTeamsMode?: ClaudeAgentTeamsMode
        }
      }
    | null
    | undefined
  claudeAgentTeams: {
    createLaunchEnv: (args: {
      leaderHandle: string
      baseEnv: Record<string, string | undefined>
      shimDir: string
      shimBin: string | null
      paneShell?: AgentStartupShell
    }) => { env: Record<string, string> }
  }
  launchOpts: {
    launchConfig?: TerminalCreateOptions['launchConfig']
    command?: string
    claudeAgentTeamsSourceCommand?: string
  }
  baseEnv: Record<string, string | undefined>
  adoptedBeforeLaunch: AdoptedBeforeLaunch
  preAllocatedHandle: string
  onError: () => void
}): Promise<{
  agentTeamsPlan: Awaited<ReturnType<typeof buildClaudeAgentTeamsLaunchPlan>> | undefined
  sequencedStartupCommand?: string
  effectiveLaunchConfig: TerminalCreateOptions['launchConfig']
}> {
  // Why: teammate panes launch on the local host, so the local Windows shell preference decides their grammar.
  const paneShell = resolveLocalWindowsAgentStartupShell({
    platform: process.platform,
    isRemote: false,
    terminalWindowsShell: args.store?.getSettings?.().terminalWindowsShell ?? null
  })
  try {
    const { plan, sequencedStartupCommand, effectiveLaunchConfig } =
      await buildRuntimeAgentTeamsLaunchPlan({
        launchConfig: args.launchOpts.launchConfig,
        command: args.launchOpts.command,
        claudeAgentTeamsSourceCommand: args.launchOpts.claudeAgentTeamsSourceCommand,
        claudeAgentTeamsMode: args.store?.getSettings?.().claudeAgentTeamsMode,
        baseEnv: args.baseEnv,
        adoptedBeforeLaunch: args.adoptedBeforeLaunch,
        paneShell,
        createTeamEnv: (shimDir, shimBin) =>
          args.claudeAgentTeams.createLaunchEnv({
            leaderHandle: args.preAllocatedHandle,
            baseEnv: args.baseEnv,
            shimDir,
            shimBin,
            paneShell
          }).env
      })
    return { agentTeamsPlan: plan, sequencedStartupCommand, effectiveLaunchConfig }
  } catch (error) {
    args.onError()
    throw error
  }
}

export async function buildRuntimeAgentTeamsLaunchPlan(args: {
  launchConfig: TerminalCreateOptions['launchConfig']
  command?: string
  claudeAgentTeamsSourceCommand?: string
  claudeAgentTeamsMode?: ClaudeAgentTeamsMode
  baseEnv: Record<string, string | undefined>
  adoptedBeforeLaunch: AdoptedBeforeLaunch
  /** Shell the panes type into; decides whether Orca can spell the teammate command. */
  paneShell?: AgentStartupShell
  createTeamEnv: (shimDir: string, shimBin: string) => Record<string, string>
}): Promise<{
  plan: Awaited<ReturnType<typeof buildClaudeAgentTeamsLaunchPlan>> | undefined
  sequencedStartupCommand?: string
  effectiveLaunchConfig: TerminalCreateOptions['launchConfig']
}> {
  const sourceCommand =
    args.claudeAgentTeamsSourceCommand?.trim() || args.command?.trim() || undefined
  const mode = inferCapturedClaudeAgentTeamsMode(
    args.launchConfig,
    sourceCommand,
    args.claudeAgentTeamsMode
  )
  const plan = args.adoptedBeforeLaunch
    ? undefined
    : await buildClaudeAgentTeamsLaunchPlan({
        command: sourceCommand,
        mode,
        baseEnv: args.baseEnv,
        paneShell: args.paneShell,
        createTeamEnv: args.createTeamEnv
      })
  const sequencedStartupCommand =
    plan && sourceCommand && args.command && sourceCommand !== args.command
      ? plan.command
      : undefined
  const effectiveLaunchConfig =
    args.launchConfig && plan
      ? {
          ...args.launchConfig,
          agentCommand: args.launchConfig.agentCommand
            ? plan.mode === 'in-process'
              ? addClaudeTeammateModeInProcess(args.launchConfig.agentCommand)
              : addClaudeTeammateModeAuto(args.launchConfig.agentCommand)
            : plan.command,
          agentEnv: { ...args.launchConfig.agentEnv, ...plan.env }
        }
      : args.launchConfig
  return { plan, sequencedStartupCommand, effectiveLaunchConfig }
}
