/**
 * The command a user runs on an SSH host to stop the relay daemons an older Orca left running.
 * Scoped like the in-app action: only `relay.js --detached` processes of this account whose
 * socket (POSIX) or credential file (Windows) lives under Orca's relay install directories.
 */
import type { SshOldRelayProcesses } from './ssh-types'

const POSIX_STOP_COMMAND =
  'pkill -u "$(id -u)" -f " relay\\.js --detached .*--sock-path ($HOME/\\.orca-remote|/tmp/\\.orca-relay-$(id -u))/relay-"'

const WINDOWS_STOP_COMMAND =
  'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | ' +
  "Where-Object { $_.CommandLine -like '*relay.js*--detached*\\.orca-remote\\relay-*' } | " +
  'ForEach-Object { Stop-Process -Id $_.ProcessId }'

export function oldRelayStopCommand(hostOs: SshOldRelayProcesses['hostOs']): string {
  return hostOs === 'windows' ? WINDOWS_STOP_COMMAND : POSIX_STOP_COMMAND
}
