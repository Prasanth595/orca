import { Readable } from 'node:stream'
import type { SshConnectionManager } from '../ssh/ssh-connection-manager'
import { execCommand } from '../ssh/ssh-relay-exec-command'

export type RemoteExecFn = (
  command: string,
  opts?: { stdin?: string; signal?: AbortSignal; timeoutMs?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

function commandExit(err: unknown): { exitCode: number; stdout: string } | null {
  if (err instanceof Error && 'exitCode' in err && typeof err.exitCode === 'number') {
    return {
      exitCode: err.exitCode,
      stdout: 'stdout' in err && typeof err.stdout === 'string' ? err.stdout : ''
    }
  }
  return null
}

/** Build a RemoteExecFn that runs commands on an SSH target. */
export function buildSshRemoteExec(manager: SshConnectionManager, targetId: string): RemoteExecFn {
  return async (command, opts = {}) => {
    const conn = manager.getConnection(targetId)
    if (!conn || conn.getState().status !== 'connected') {
      throw new Error(
        `SSH target "${targetId}" is not connected. Connect in the SSH sidebar first.`
      )
    }
    let stdoutBuf = ''
    let stderrBuf = ''
    let exitCode = 0
    try {
      const stdinStream = opts.stdin !== undefined ? Readable.from([opts.stdin]) : undefined
      stdoutBuf = await execCommand(conn, command, {
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        stdin: stdinStream,
        onStderr: (s) => {
          stderrBuf += s
        }
      })
    } catch (err) {
      // A command that ran and exited non-zero is a result, as it is locally; a lost connection,
      // timeout or cancel is not, so it fails the node instead of reading as exit 1.
      const exit = commandExit(err)
      if (!exit) {
        throw err
      }
      exitCode = exit.exitCode
      stdoutBuf = exit.stdout
      stderrBuf = stderrBuf || (err instanceof Error ? err.message : String(err))
    }
    return { stdout: stdoutBuf, stderr: stderrBuf, exitCode }
  }
}
