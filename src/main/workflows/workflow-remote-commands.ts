import { quotePosixShell as q } from '../../shared/wsl-login-shell-command'
import type { PythonScriptData, ShellCommandData } from '../../shared/workflow-types'

// Shells a POSIX SSH host can run; a Windows default (powershell/cmd) copied into an SSH
// workflow falls back to the login shell rather than failing on a missing binary.
const POSIX_SHELL = /^(?:\/[\w./-]+|bash|sh|zsh|dash|ksh|fish|tcsh|csh)$/

/** `cd <dir> && ` when the node names a working directory on the host. */
export function remoteCwdPrefix(workingDirectory: string | undefined): string {
  const dir = workingDirectory?.trim()
  return dir ? `cd ${q(dir)} && ` : ''
}

/** Shell node on an SSH host: honors its working directory, shell and environment there. */
export function buildRemoteShellCommand(data: ShellCommandData): string {
  const env = Object.entries(data.env ?? {})
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `${name}=${q(value)}`)
  const requested = data.shell?.trim() ?? ''
  const shell = POSIX_SHELL.test(requested) ? requested : null
  // No chosen shell and no env: the login shell runs the command as typed, grouped so a failed
  // `cd` stops every statement in it.
  const body =
    shell === null && env.length === 0
      ? `{ ${data.command}\n}`
      : `${env.length > 0 ? `env ${env.join(' ')} ` : ''}${q(shell ?? 'sh')} -c ${q(data.command)}`
  return `${remoteCwdPrefix(data.workingDirectory)}${body}`
}

/**
 * Python node on an SSH host. The script travels base64-encoded inside `-c` so stdin stays free
 * for the upstream node's output, exactly as it is locally, and no shell expansion touches it.
 */
export function buildRemotePythonCommand(data: PythonScriptData): string {
  const python = data.pythonBin?.trim() || 'python3'
  const encoded = Buffer.from(data.script, 'utf8').toString('base64')
  const loader = `import base64;exec(compile(base64.b64decode('${encoded}').decode('utf-8'),'<workflow>','exec'))`
  return `${remoteCwdPrefix(data.workingDirectory)}${q(python)} -c ${q(loader)}`
}
