/**
 * The command a user runs on an SSH host to stop the relay daemons an older Orca left running.
 * Scoped like the in-app action: only `<node> relay.js --detached` processes of this account whose
 * socket (POSIX) or credential file (Windows) lives under its Orca relay install directories.
 */
import type { SshOldRelayProcesses } from './ssh-types'

// Anchored at argv[0] so a shell whose script text mentions a relay launch never matches.
const POSIX_STOP_COMMAND =
  'pkill -u "$(id -u)" -f "^([^ ]*/)?node[^ /]* relay\\.js --detached .*--sock-path ($HOME/\\.orca-remote|/tmp/\\.orca-relay-$(id -u))/relay-"'

// Owner-checked: an elevated shell would otherwise reach other accounts' relays.
const WINDOWS_STOP_COMMAND =
  'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | ' +
  'Where-Object { $_.CommandLine -like "*relay.js* --detached *$env:USERPROFILE\\.orca-remote\\relay-*" -and ' +
  '($o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User -eq $env:USERNAME -and $o.Domain -eq $env:USERDOMAIN } | ' +
  'ForEach-Object { Stop-Process -Id $_.ProcessId }'

export function oldRelayStopCommand(hostOs: SshOldRelayProcesses['hostOs']): string {
  return hostOs === 'windows' ? WINDOWS_STOP_COMMAND : POSIX_STOP_COMMAND
}
