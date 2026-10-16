import { homedir } from 'node:os'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { CommitMessageDraftContext } from '../../shared/commit-message-generation'
import { buildPerforceDescriptionPrompt as buildPerforcePrompt } from '../../shared/perforce/perforce-description-prompt'
import { resolvePerforceAiParams } from '../../shared/perforce/perforce-ai-params'
import { requireRelativePaths } from '../../shared/perforce/perforce-arguments'
import {
  getPerforceSettings,
  PERFORCE_SSH_UNSUPPORTED_MESSAGE,
  resolvePerforceBackend
} from '../perforce/perforce-ssh-backend'
import {
  generateCommitMessageFromContext,
  type GenerateCommitMessageResult
} from '../text-generation/commit-message-text-generation'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'
import { getLocalGitOptionsForRegisteredWorktree } from './local-worktree-runtime-options'
import { resolveRegisteredWorktreePath } from './registered-worktree-roots-cache'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import {
  getLocalAgentRuntimeTarget,
  getLocalTextGenerationTarget
} from './filesystem/filesystem-source-control-ai-targets'

type GenerateArgs = {
  worktreePath: string
  connectionId?: string
  changelist: 'default' | 'new' | number
  filePaths: string[]
  patch?: string
}

async function buildContext(
  args: GenerateArgs,
  cwd: string
): Promise<CommitMessageDraftContext | null> {
  const filePaths = requireRelativePaths(args.filePaths)
  const patch =
    typeof args.patch === 'string'
      ? args.patch
      : await resolvePerforceBackend(args.connectionId).diffText(cwd, filePaths)
  const label =
    args.changelist === 'default'
      ? 'default changelist'
      : args.changelist === 'new'
        ? 'new changelist'
        : `changelist ${args.changelist}`
  // Why: the shared prompt is worded for git; the file summary tells the agent this is a Perforce changelist.
  return {
    branch: null,
    stagedSummary: `Perforce ${label} (opened files):\n${filePaths.join('\n')}`,
    stagedPatch: patch
  }
}

/** Drafts a changelist description with the same provider and prompt settings as commit messages. */
export function registerPerforceDescriptionGeneration(
  store: Store,
  commitMessageAgentEnv: CommitMessageAgentEnvironmentResolvers | undefined
): void {
  ipcMain.handle(
    'perforce:generateDescription',
    async (_event, args: GenerateArgs): Promise<GenerateCommitMessageResult> => {
      if (!getPerforceSettings().aiDescriptionEnabled) {
        return { success: false, error: 'AI descriptions are turned off in Settings > Perforce.' }
      }
      const prompt = (context: CommitMessageDraftContext): string =>
        buildPerforcePrompt(context, getPerforceSettings().aiInstructions)
      const resolved = resolvePerforceAiParams({
        settings: store.getSettings(),
        perforce: getPerforceSettings()
      })
      if (!resolved.ok) {
        return { success: false, error: resolved.error }
      }
      if (args.connectionId) {
        return { success: false, error: PERFORCE_SSH_UNSUPPORTED_MESSAGE }
      }
      // Why: a runtime-hosted workspace's files live on its server, which already read the diff;
      // the agent runs here with only that text, from the home directory.
      const remotePatch = typeof args.patch === 'string'
      const worktreePath = remotePatch
        ? homedir()
        : await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = remotePatch
        ? {}
        : getLocalGitOptionsForRegisteredWorktree(store, args.worktreePath, worktreePath)
      const context = await buildContext(args, worktreePath).catch(() => null)
      if (!context) {
        return { success: false, error: 'Failed to read the changelist diff.' }
      }
      const localEnv = await prepareLocalCommitMessageAgentEnv(
        resolved.params.agentId,
        commitMessageAgentEnv,
        getLocalAgentRuntimeTarget(gitOptions)
      )
      if (!localEnv.ok) {
        return { success: false, error: localEnv.error }
      }
      return generateCommitMessageFromContext(
        context,
        resolved.params,
        getLocalTextGenerationTarget(worktreePath, gitOptions, localEnv.env),
        prompt(context)
      )
    }
  )
}
