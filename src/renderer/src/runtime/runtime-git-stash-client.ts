import type { GitStashOptions, GitStashResult, GitStashListResult } from '../../../shared/git-stash'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-client-context'
import { callRuntimeRpc, hasRuntimeRpcErrorCode } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'

export async function stashRuntimeGit(
  context: RuntimeGitContext,
  request: GitStashOptions
): Promise<GitStashResult> {
  if (context.target.kind === 'local') {
    return window.api.git.stash({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId,
      ...request
    })
  }
  if (!context.worktreeId) {
    throw new Error('Missing workspace for stash')
  }
  try {
    return await callRuntimeRpc<GitStashResult>(
      context.target,
      'git.stash',
      { worktree: toRuntimeWorktreeSelector(context.worktreeId), ...request },
      { timeoutMs: 30_000 }
    )
  } catch (error) {
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      throw new Error('Update Orca on the execution host to use Stash and Stash Pop.')
    }
    throw error
  }
}

export async function listRuntimeGitStashes(
  context: RuntimeGitContext
): Promise<GitStashListResult> {
  if (context.target.kind === 'local') {
    return window.api.git.stashList({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
  }
  if (!context.worktreeId) {
    throw new Error('Missing workspace for stash')
  }
  try {
    return await callRuntimeRpc<GitStashListResult>(
      context.target,
      'git.stashList',
      { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
      { timeoutMs: 30_000 }
    )
  } catch (error) {
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      throw new Error('Update Orca on the execution host to manage stashes.')
    }
    throw error
  }
}
