import { Readable } from 'node:stream'
import type { SshConnectionManager } from '../ssh/ssh-connection-manager'
import { execCommand } from '../ssh/ssh-relay-exec-command'

export type RemoteExecFn = (
  command: string,
  opts?: { stdin?: string; signal?: AbortSignal; timeoutMs?: number }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

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
      exitCode = 1
      stderrBuf = err instanceof Error ? err.message : String(err)
    }
    return { stdout: stdoutBuf, stderr: stderrBuf, exitCode }
  }
}
