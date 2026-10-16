import { useAppStore } from '@/store'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import {
  resolveSshHostReportedPlatform,
  resolveAgentResumeLaunchTarget
} from '@/lib/agent-resume-launch-target'
import {
  getExecutionHostIdForWorktree,
  getExplicitRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { normalizeAgentProviderSession } from '../../../shared/agent-session-resume'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../shared/agent-session-resume'
import { CODEX_ACCOUNT_RESTART_STARTUP } from './codex-session-restart'

type AccountRestartAgent = 'codex' | 'claude'

export type AccountRestartStartup<A extends AccountRestartAgent = AccountRestartAgent> = {
  command: string
  startupCommandDelivery: 'shell-ready'
  launchAgent: A
  env?: Record<string, string>
  launchConfig?: SleepingAgentLaunchConfig
  resumeProviderSession?: AgentProviderSessionMetadata
}

export type CodexAccountRestartStartup = AccountRestartStartup<'codex'>

type AccountRestartPane = {
  tabId: string
  leafId: string
  worktreeId: string
  shellOverride?: string
}

// Capture the session before restart clears the old pane’s status.
export function buildCodexAccountRestartStartup(
  args: AccountRestartPane
): CodexAccountRestartStartup {
  return buildAccountRestartResume('codex', args) ?? CODEX_ACCOUNT_RESTART_STARTUP
}

/** Reopens a Claude pane's conversation; null when it can't, since a blank restart would lose it. */
export function buildClaudeSessionMoveStartup(
  args: AccountRestartPane
): AccountRestartStartup<'claude'> | null {
  return buildAccountRestartResume('claude', args)
}

function buildAccountRestartResume<A extends AccountRestartAgent>(
  agent: A,
  args: AccountRestartPane
): AccountRestartStartup<A> | null {
  const state = useAppStore.getState()
  const paneKey = makePaneKey(args.tabId, args.leafId)
  const entry = state.agentStatusByPaneKey[paneKey]
  const sleeping = state.sleepingAgentSessionsByPaneKey[paneKey]
  const agentType = entry?.agentType ?? sleeping?.agent
  if (agentType !== agent) {
    return null
  }
  const providerSession =
    normalizeAgentProviderSession(entry?.providerSession) ??
    normalizeAgentProviderSession(sleeping?.agent === agent ? sleeping.providerSession : undefined)
  if (!providerSession) {
    return null
  }
  const projectRuntime = getLocalProjectExecutionRuntimeContext(state, args.worktreeId)
  if (projectRuntime?.status === 'resolved' && projectRuntime.runtime.kind === 'wsl') {
    return null
  }
  const worktree = state.getKnownWorktreeById(args.worktreeId)
  const repo = worktree ? state.repos.find((entry) => entry.id === worktree.repoId) : null
  const launchConfig =
    (entry ? state.getAgentLaunchConfigForStatusEntry(entry) : undefined) ??
    (sleeping?.agent === agent ? sleeping.launchConfig : undefined)
  const executionHostId = getExecutionHostIdForWorktree(state, args.worktreeId)
  const resumeTarget = resolveAgentResumeLaunchTarget({
    projectRuntime,
    connectionId: repo?.connectionId,
    executionHostId,
    worktreePath: worktree?.path,
    terminalWindowsShell: state.settings?.terminalWindowsShell,
    tabShellOverride: args.shellOverride,
    remotePlatform: resolveSshHostReportedPlatform(
      state,
      executionHostId,
      getExplicitRuntimeEnvironmentIdForWorktree(state, args.worktreeId)
    )
  })
  const startupPlan = buildAgentResumeStartupPlan({
    agent,
    providerSession,
    cmdOverrides: state.settings?.agentCmdOverrides ?? {},
    agentArgs:
      launchConfig !== undefined
        ? launchConfig.agentArgs
        : resolveTuiAgentLaunchArgs(agent, state.settings?.agentDefaultArgs),
    agentEnv:
      launchConfig !== undefined
        ? launchConfig.agentEnv
        : resolveTuiAgentLaunchEnv(agent, state.settings?.agentDefaultEnv),
    ...(launchConfig?.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
    ...(launchConfig?.ompResumeFilePath
      ? { ompResumeFilePath: launchConfig.ompResumeFilePath }
      : {}),
    platform: resumeTarget.platform,
    shell: resumeTarget.shell
  })
  if (!startupPlan) {
    return null
  }
  return {
    startupCommandDelivery: 'shell-ready',
    launchAgent: agent,
    command: startupPlan.launchCommand,
    ...(startupPlan.env ? { env: startupPlan.env } : {}),
    launchConfig: startupPlan.launchConfig,
    // Why it rides along: main only repins the launch home for a spawn that
    // names the session it is resuming, so dropping this drops the account move.
    resumeProviderSession: providerSession
  }
}
