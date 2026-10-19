import { isGitForWindowsBashLauncherPath } from '../git-bash'
import type { WindowsProcessIdentityRow } from '../windows/windows-process-table'
import {
  buildProcessTableIndex,
  collectDescendantsFromIndex
} from '../../shared/process-table-index'

const MSYS_BASH_IMAGE = 'bash.exe'

/**
 * Whether a pane's job holds only its shell: no job member descends from the
 * shell through live parents, or, for Git for Windows' `bin\bash.exe` launcher,
 * the ones that do form one unbranched chain of MSYS bash processes.
 *
 * The job keeps every process ever started in the pane, including daemons whose
 * parent exited (rc-started `ssh-agent`), so only members still linked to the
 * shell count, as in a POSIX descendant walk.
 *
 * The launcher hands off to `usr\bin\bash.exe` and waits, and every MSYS `exec`
 * (Orca's `chcp.com ...; exec "$BASH" ... -i` startup) leaves the pre-exec
 * process alive as a stub waiting on its successor. So an idle prompt is
 * `launcher -> bash -> ... -> bash`, the leaf being the interactive shell. A
 * command at the prompt adds a non-bash leaf, and a background job branches.
 *
 * Residual: a foreground bash running only builtins (a nested `bash`, a
 * subshell loop, a fork caught before its exec) is also a bash leaf, so it reads
 * as a shell at a prompt.
 */
export async function isWindowsShellAloneInJob(
  shellPid: number,
  spawnedShellPath: string,
  jobProcessIds: ReadonlySet<number> | null | undefined,
  readIdentityTable: () => Promise<WindowsProcessIdentityRow[]>
): Promise<boolean> {
  if (!jobProcessIds?.has(shellPid)) {
    return false
  }
  if (jobProcessIds.size === 1) {
    return true
  }
  const members = (await readIdentityTable()).filter((row) => jobProcessIds.has(row.pid))
  // A member missing from the table exited or was never readable: no proof either way.
  if (members.length !== jobProcessIds.size) {
    return false
  }
  const index = buildProcessTableIndex(members)
  const descendants = collectDescendantsFromIndex(index, shellPid)
  if (
    descendants.some((row) =>
      startedBefore(row.creationTimeMs, index.byPid.get(row.ppid)?.creationTimeMs)
    )
  ) {
    return false
  }
  if (descendants.length === 0) {
    return true
  }
  // One row per depth is an unbranched chain.
  return (
    isGitForWindowsBashLauncherPath(spawnedShellPath) &&
    descendants.every((row) => row.name.toLowerCase() === MSYS_BASH_IMAGE) &&
    new Set(descendants.map((row) => row.depth)).size === descendants.length
  )
}

/** A child older than its parent carries a reused ppid; only checkable when the snapshot has start times. */
function startedBefore(
  childStartMs: number | undefined,
  parentStartMs: number | undefined
): boolean {
  return childStartMs !== undefined && parentStartMs !== undefined && childStartMs < parentStartMs
}
