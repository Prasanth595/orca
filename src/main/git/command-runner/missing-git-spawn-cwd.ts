import { stat } from 'node:fs/promises'
import { isDefinitiveAbsence } from '../../../shared/definitive-filesystem-absence'
import { waitForPromiseWithSignal } from '../../../shared/abort-signal-reason'
import { isMissingCommandBinaryError } from '../exec-error'
import type { ResolvedCommand } from './wsl-command-resolution'

const MAX_KNOWN_MISSING_CWDS = 256
// Why: in memory only; a deleted project folder otherwise spawns a failing Git on every sweep.
const knownMissingCwds = new Set<string>()

// Why: WSL and UNC absence is not a cheap local answer; loss of contact is not proof.
function recordableCwd({ cwd, wsl }: ResolvedCommand): string | null {
  return wsl === null && cwd && !/^[\\/]{2}/.test(cwd) ? cwd : null
}

// Why stat: spawn's chdir follows symlinks, so a symlinked root whose target is gone is absent too.
function isCwdAbsent(cwd: string): Promise<boolean> {
  return stat(cwd).then(() => false, isDefinitiveAbsence)
}

/** Records a native cwd once a spawn ENOENT is proven to mean the folder, not the binary, is gone. */
export async function noteGitSpawnFailure(
  error: unknown,
  command: ResolvedCommand,
  signal?: AbortSignal
): Promise<void> {
  const cwd = recordableCwd(command)
  if (!cwd || !isMissingCommandBinaryError(error) || signal?.aborted || knownMissingCwds.has(cwd)) {
    return
  }
  // Why re-check: concurrent first failures for one folder must record and warn once.
  if (!(await isCwdAbsent(cwd)) || knownMissingCwds.has(cwd)) {
    return
  }
  knownMissingCwds.add(cwd)
  if (knownMissingCwds.size > MAX_KNOWN_MISSING_CWDS) {
    knownMissingCwds.delete(knownMissingCwds.values().next().value ?? cwd)
  }
  console.warn('[git] repository folder missing; skipping Git there until it returns:', cwd)
}

/** Null for every cwd not known missing, so healthy repos pay one Set lookup and no await. */
export function pendingKnownMissingGitCwdCheck(
  cwd: string | undefined,
  resolveCommand: () => ResolvedCommand,
  signal?: AbortSignal,
  encoding?: BufferEncoding | 'buffer'
): Promise<void> | null {
  if (!cwd || !knownMissingCwds.has(cwd)) {
    return null
  }
  const command = resolveCommand()
  if (recordableCwd(command) !== cwd) {
    return null
  }
  return waitForPromiseWithSignal(isCwdAbsent(cwd), signal).then((absent) => {
    if (!absent) {
      knownMissingCwds.delete(cwd)
      return
    }
    const empty = encoding === 'buffer' ? Buffer.alloc(0) : ''
    // Why: same shape as the real spawn failure, so every caller keeps its existing result.
    throw Object.assign(new Error(`spawn ${command.binary} ENOENT`), {
      code: 'ENOENT',
      syscall: `spawn ${command.binary}`,
      path: command.binary,
      spawnargs: command.args,
      stdout: empty,
      stderr: empty
    })
  })
}
