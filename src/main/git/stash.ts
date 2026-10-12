import type { GitStashListResult, GitStashOptions, GitStashResult } from '../../shared/git-stash'
import { isStashStagedUnsupportedError } from '../../shared/git-stash-capability'
import { runWithGitOperationLock } from '../../shared/git-operation-lock'
import { getCanonicalRepoKey } from './canonical-repo-key'
import { GitStash } from '../../shared/rpc-contract/git-params'
import { withLocalGitCapabilityCacheForExecution } from './git-capability-state'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { runWithGitReadCacheInvalidation } from './status'

export async function listGitStashes(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<GitStashListResult> {
  const { stdout } = await gitExecFileAsync(
    ['stash', 'list', '--max-count=201', '--format=%gd%x00%H%x00%s'],
    gitOptionsForWorktree(worktreePath, options)
  )
  const entries = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, oid, subject = ''] = line.trimEnd().split('\0')
      if (!ref || !oid) {
        throw new Error('Invalid stash list entry')
      }
      return { ref, oid, subject }
    })
  return { entries: entries.slice(0, 200), truncated: entries.length > 200 }
}

export async function gitStash(
  worktreePath: string,
  request: GitStashOptions,
  options: GitRuntimeOptions = {}
): Promise<GitStashResult> {
  const validated = GitStash.parse({ ...request, worktree: worktreePath })
  const key = await getCanonicalRepoKey(worktreePath, options)
  // Stash refs are shared across worktrees; keep validation and mutation in one lane.
  return runWithGitOperationLock(`stash:${key}`, options.signal, () =>
    executeGitStash(worktreePath, validated, options)
  )
}

async function executeGitStash(
  worktreePath: string,
  request: GitStashOptions,
  options: GitRuntimeOptions
): Promise<GitStashResult> {
  const { action, stash, message, expectedStashes } = request
  const gitOptions = gitOptionsForWorktree(worktreePath, options)
  if (stash) {
    const { stdout } = await gitExecFileAsync(['rev-parse', '--verify', stash.ref], gitOptions)
    if (stdout.trim() !== stash.oid) {
      throw new Error('The stash list changed. Select the stash again.')
    }
  }
  if (action === 'show') {
    if (!stash) {
      throw new Error('Select a stash to view')
    }
    const { stdout } = await gitExecFileAsync(
      ['stash', 'show', '--patch', '--no-ext-diff', '--no-color', stash.oid],
      gitOptions
    )
    const parents = await gitExecFileAsync(
      ['rev-list', '--parents', '--max-count=1', stash.oid],
      gitOptions
    )
    const untrackedParent = parents.stdout.trim().split(' ')[3]
    if (!untrackedParent) {
      return { output: stdout.trim() }
    }
    const untracked = await gitExecFileAsync(
      [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--patch',
        '--no-ext-diff',
        '--no-color',
        untrackedParent
      ],
      gitOptions
    )
    return { output: `${stdout}${untracked.stdout}`.trim() }
  }
  if (action === 'drop' && !stash) {
    throw new Error('Select a stash to drop')
  }
  if (action === 'clear') {
    const current = await listGitStashes(worktreePath, options)
    if (
      !expectedStashes ||
      current.truncated ||
      current.entries.map((entry) => entry.oid).join(',') !== expectedStashes.join(',')
    ) {
      throw new Error('The stash list changed. Review the stashes before dropping all.')
    }
  }
  const args = action.startsWith('push')
    ? [
        'stash',
        'push',
        ...(action === 'push_untracked'
          ? ['--include-untracked']
          : action === 'push_staged'
            ? ['--staged']
            : []),
        ...(message?.trim() ? ['--message', message.trim()] : [])
      ]
    : ['stash', action, ...(stash ? [action === 'apply' ? stash.oid : stash.ref] : [])]
  const run = () => gitExecFileAsync(args, gitOptions)
  const { stdout } = await runWithGitReadCacheInvalidation(() =>
    action === 'push_staged'
      ? withLocalGitCapabilityCacheForExecution(gitOptions, (capabilities) =>
          capabilities.runWithFallback(
            'stash-push-staged',
            run,
            async () => {
              throw new Error('Stash Staged requires Git 2.35 or newer on the execution host.')
            },
            isStashStagedUnsupportedError
          )
        )
      : run()
  )
  return { output: stdout.trim() }
}
