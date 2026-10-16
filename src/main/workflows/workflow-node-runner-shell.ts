import { runProcess } from '@orca/process-host'
import type { ShellCommandData } from '../../shared/workflow-types'
import type { RemoteExecFn } from './workflow-remote-exec'
import { buildRemoteShellCommand } from './workflow-remote-commands'

export type ShellNodeResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

export function shellToArgs(shell: string, cmd: string): [string, string[]] {
  const s = shell.toLowerCase()
  if (s === 'powershell' || s === 'powershell.exe') {
    return ['powershell.exe', ['-Command', cmd]]
  }
  if (s === 'cmd' || s === 'cmd.exe') {
    return ['cmd.exe', ['/c', cmd]]
  }
  // Unix shells (zsh, bash, sh, tcsh, …) — treat bare names as /bin/<name>
  const program = shell.startsWith('/') ? shell : `/bin/${shell}`
  return [program, ['-c', cmd]]
}

export async function runShellCommandNode(
  data: ShellCommandData,
  stdin?: string,
  remoteExec?: RemoteExecFn,
  signal?: AbortSignal
): Promise<ShellNodeResult> {
  if (remoteExec) {
    const result = await remoteExec(buildRemoteShellCommand(data), {
      stdin,
      signal,
      timeoutMs: data.timeoutSeconds * 1000
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
  }
  const defaultArgs: [string, string[]] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-Command', data.command]]
      : ['/bin/sh', ['-c', data.command]]
  const [program, args] = data.shell ? shellToArgs(data.shell, data.command) : defaultArgs
  const result = await runProcess({
    program,
    args,
    cwd: data.workingDirectory || undefined,
    env: data.env,
    timeoutMs: data.timeoutSeconds * 1000,
    input: stdin
  })
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code
  }
}
