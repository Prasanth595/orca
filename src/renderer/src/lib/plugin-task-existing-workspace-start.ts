import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { resolveRepoWorktreeLaunchPlatform } from '@/lib/execution-host-facts'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { persistCreatedWorkspacePluginTaskLink } from '@/lib/plugin-task-workspace-link'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import type { LinkedPluginTask } from '../../../shared/plugins/plugin-task-link'
import type { TuiAgent } from '../../../shared/tui-agent'

type StartTaskInExistingWorkspaceArgs = {
  agent: TuiAgent | null
  worktreeId: string
  prompt: string
  link?: LinkedPluginTask
  sessionOptions?: Record<string, string>
}

/** Opens an agent tab in an existing workspace with the task's prompt typed in but not sent. */
export function startTaskInExistingWorkspace(args: StartTaskInExistingWorkspaceArgs): boolean {
  const { agent, worktreeId } = args
  if (!agent) {
    toast.error(
      translate(
        'auto.lib.pluginTaskExistingWorkspaceStart.noAgent',
        'Pick an agent to start this task in a workspace.'
      )
    )
    return false
  }
  const store = useAppStore.getState()
  const worktree = store.allWorktrees().find((candidate) => candidate.id === worktreeId)
  if (!worktree) {
    toast.error(
      translate(
        'auto.lib.pluginTaskExistingWorkspaceStart.missingWorkspace',
        'That workspace is no longer available.'
      )
    )
    return false
  }
  const repo = store.repos.find((candidate) => candidate.id === worktree.repoId)
  // Why: undefined lets the launch resolve the host itself and tell the user why it stopped.
  const launchPlatform = repo ? resolveRepoWorktreeLaunchPlatform(store, repo, worktree) : undefined
  let revealFailed = false
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent,
    worktreeId,
    prompt: args.prompt,
    promptDelivery: 'draft',
    launchPlatform,
    launchSource: 'task_page',
    ...(args.sessionOptions ? { sessionOptions: args.sessionOptions } : {}),
    beforeSurfaceOpen: () => {
      // Why: the launcher owns the initial surface, so revealing must not seed a sibling shell.
      revealFailed =
        activateAndRevealWorktree(worktreeId, { providesInitialSurface: true }) === false
      return !revealFailed
    }
  })
  if (!result) {
    toast.error(
      revealFailed
        ? translate(
            'auto.lib.pluginTaskExistingWorkspaceStart.revealFailed',
            'Unable to open that workspace.'
          )
        : translate(
            'auto.lib.pluginTaskExistingWorkspaceStart.launchFailed',
            'Could not build the agent launch command.'
          )
    )
    return false
  }
  if (result.surface.kind === 'local-terminal') {
    focusTerminalTabSurface(result.surface.tabId)
  }
  persistCreatedWorkspacePluginTaskLink(worktreeId, args.link)
  return true
}
