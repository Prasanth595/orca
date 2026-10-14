/**
 * Escaping the service cgroup for the detached PTY daemon.
 *
 * `detached: true` buys the daemon its own POSIX process group, not its own cgroup: under a
 * combined unit (`orca-serve.service` / `orca-serve@<slot>`) it and its PTYs stay in the unit's
 * cgroup, and `systemctl stop`/`restart` SIGKILLs whatever is left there — immediately under
 * `KillMode=control-group`, and the instant the main process exits under `KillMode=mixed`
 * (`TimeoutStopSec` only applies while that main process is still alive). Either way every
 * live terminal dies, however well the daemon otherwise survives its parent.
 *
 * `systemd-run --user --scope` registers a transient scope under the invoking user's own systemd
 * manager and execs the command into it, so the daemon's cgroup becomes a *sibling* of the
 * unit's that no unit-scoped kill reaches; `--collect` drops the unit once it exits.
 *
 * That needs systemd as PID 1, a reachable `--user` manager, and one that outlives the caller:
 * `loginctl enable-linger <user>`, unless the caller already runs inside that manager (see
 * daemon-user-manager-lifetime.ts). Everywhere else keeps the direct-fork
 * launch, so this module fails closed to "not supported" rather than guessing.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runProcessSync } from '@orca/process-host'
import type { ProcessResult } from '@orca/process-host/process-spec'
import { removeChromiumDisabledSessionBus } from '../pty/chromium-session-bus-env'
import { userManagerOutlivesCaller } from './daemon-user-manager-lifetime'
import { UNIT_NAME_PREFIX, readLegacyDaemonScopeProcesses } from './daemon-scope-cgroup-membership'
import {
  busctlOomPolicyProperties,
  parseSystemdMajorVersion,
  parseSystemdManagerVersion,
  supportsScopeOomPolicy,
  systemdRunOomPolicyArgs,
  type DurableDaemonScopeOptions
} from './systemd-scope-oom-policy'

const SYSTEMD_RUN_BINARY = 'systemd-run'
/** The marker that distinguishes "booted under systemd" from a plain container. A test seam so
 *  the capability tests stay hermetic off a systemd host. */
const SYSTEMD_BOOT_PATH = '/run/systemd/system'
/** Long enough for a local binary to print its version, short enough that a wedged systemd
 *  cannot stall the launch lane. */
const SYSTEMD_RUN_PROBE_TIMEOUT_MS = 2_000
const SYSTEMD_SCOPE_MIGRATION_TIMEOUT_MS = 5_000

/** The conventional per-UID runtime dir every login session (and `loginctl enable-linger`)
 *  provisions, from `getuid()` rather than from the environment. The exported functions'
 *  `canonicalRuntimeDir` parameters default to this so production uses the real path; tests
 *  inject a fake one. */
const CANONICAL_USER_RUNTIME_DIR =
  typeof process.getuid === 'function' ? `/run/user/${process.getuid()}` : null

/** systemd unit names are restricted to `[A-Za-z0-9:_.\-@]`; sanitize defensively even though
 *  `launchNonce` is already a UUID (hyphens and hex digits only). */
export function daemonScopeUnitName(launchNonce: string): string {
  return `${UNIT_NAME_PREFIX}${launchNonce.replace(/[^A-Za-z0-9:_.-]/g, '-')}.scope`
}

/** `isSocket()`, not `existsSync()`: a stale file or leftover directory at `bus` can never be
 *  dialed as one. Cheapest approximation of "connectable" that keeps this probe side-effect-free. */
function hasReachableBus(runtimeDir: string): boolean {
  try {
    return statSync(join(runtimeDir, 'bus')).isSocket()
  } catch {
    return false
  }
}

/**
 * The `XDG_RUNTIME_DIR` that actually hosts this OS user's systemd `--user` bus: the canonical
 * per-UID path first, the process's own env var only as a fallback.
 *
 * Why not that env var first: `RuntimeDirectory=` hardening (`orca-serve@factory.service` on
 * mtl-02) makes systemd export `XDG_RUNTIME_DIR=/run/orca_serve/<slot>`, a private scratch dir
 * that shares the name but hosts no bus, alongside `DBUS_SESSION_BUS_ADDRESS=disabled:` — while
 * the real bus was live at `/run/user/<uid>` the whole time. Trusting the env var reported
 * "unsupported" on every host hardened that way. It stays as the fallback for hosts that have no
 * `/run/user/<uid>` but do have a working bus wherever they point.
 */
function resolveUserRuntimeDir(env: NodeJS.ProcessEnv, canonicalDir: string | null): string | null {
  if (canonicalDir && hasReachableBus(canonicalDir)) {
    return canonicalDir
  }
  if (env.XDG_RUNTIME_DIR && hasReachableBus(env.XDG_RUNTIME_DIR)) {
    return env.XDG_RUNTIME_DIR
  }
  return null
}

/**
 * Best-effort, side-effect-free capability probe. Never throws; any uncertainty resolves to
 * "not supported" so the caller falls back to the existing, already-proven direct-fork launch.
 *
 * Stays synchronous: `launchDaemonChild` attaches the readiness listener in the same tick it is
 * called, and an await here would move the spawn past that tick. The child-process chokepoint
 * covers this shape with `runProcessSync` (as `isPwshAvailable` does) so the probe still gets
 * the shared spawn decisions instead of re-deciding them with `execFileSync`.
 *
 * `systemdBootPath` and `runVersionProbe` are test seams: they default to the real boot marker
 * and `systemd-run --version` probe, and a test injects fakes so the capability probe never
 * consults the host's own systemd.
 */

/** The slice of `ProcessResult` the capability probe consumes; narrow so a test stub carries no
 *  stderr/signal baggage. `stdout` is optional so a version-less stub still means "supported". */
type SystemdProbeResult = Pick<ProcessResult, 'code' | 'timedOut'> & { stdout?: string }

type SystemdRunVersionProbe = (binary: string, timeoutMs: number) => SystemdProbeResult

type SystemdManagerVersionProbe = (timeoutMs: number, env: NodeJS.ProcessEnv) => SystemdProbeResult

type SystemdScopeMigrationRunner = (
  command: DurableDaemonScopeCommand,
  timeoutMs: number
) => Pick<ProcessResult, 'code' | 'timedOut'>

function runSystemdRunVersionProbe(binary: string, timeoutMs: number): SystemdProbeResult {
  return runProcessSync({ program: binary, args: ['--version'], timeoutMs, maxOutputBytes: 4096 })
}

// The user manager, not the systemd-run binary, accepts the scope properties; it can lag after an upgrade.
function runSystemdManagerVersionProbe(
  timeoutMs: number,
  env: NodeJS.ProcessEnv
): SystemdProbeResult {
  return runProcessSync({
    program: 'systemctl',
    args: ['--user', 'show', '-p', 'Version', '--value'],
    env,
    timeoutMs,
    maxOutputBytes: 4096
  })
}

/** Test seams shared by the scope probe and the legacy migration; each defaults to the real host. */
type ScopeProbeDeps = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  canonicalRuntimeDir?: string | null
  systemdBootPath?: string
  runVersionProbe?: SystemdRunVersionProbe
  runManagerVersionProbe?: SystemdManagerVersionProbe
  outlivesCaller?: () => boolean
}

export type DurableDaemonScopeCapability =
  | { supported: false }
  | {
      supported: true
      systemdMajorVersion: number | null
      managerMajorVersion: number | null
      oomPolicyContinue: boolean
    }

// Why not `??`: an explicit null means "no canonical dir", not "use the real one".
function resolveCanonicalRuntimeDir(deps: ScopeProbeDeps): string | null {
  return deps.canonicalRuntimeDir !== undefined
    ? deps.canonicalRuntimeDir
    : CANONICAL_USER_RUNTIME_DIR
}

function probeScopeClient(deps: ScopeProbeDeps): { systemdMajorVersion: number | null } | null {
  const {
    env = process.env,
    platform = process.platform,
    systemdBootPath = SYSTEMD_BOOT_PATH,
    runVersionProbe = runSystemdRunVersionProbe,
    outlivesCaller = userManagerOutlivesCaller
  } = deps
  if (platform !== 'linux') {
    return null
  }
  if (!existsSync(systemdBootPath)) {
    // Not booted under systemd (e.g. a plain container without systemd as PID 1) — a unit
    // restart isn't the failure mode there, and systemd-run has nothing to talk to anyway.
    return null
  }
  if (!resolveUserRuntimeDir(env, resolveCanonicalRuntimeDir(deps))) {
    // No reachable user bus/session at the real per-UID path or the process's own env var —
    // systemd-run --user would just fail to connect.
    return null
  }
  if (!outlivesCaller()) {
    // A bus only proves a login session is open now; without linger the scope dies at logout.
    return null
  }
  try {
    const probe = runVersionProbe(SYSTEMD_RUN_BINARY, SYSTEMD_RUN_PROBE_TIMEOUT_MS)
    // A non-zero exit is data here rather than a throw, and a timeout kill leaves an exit behind
    // that answers nothing — both mean "cannot be trusted to place the daemon in a scope".
    if (probe.code !== 0 || probe.timedOut) {
      return null
    }
    return {
      systemdMajorVersion:
        probe.stdout === undefined ? null : parseSystemdMajorVersion(probe.stdout)
    }
  } catch {
    // Throws only when the binary could not be started at all.
    return null
  }
}

function probeManagerMajorVersion(deps: ScopeProbeDeps): number | null {
  const { env = process.env, runManagerVersionProbe = runSystemdManagerVersionProbe } = deps
  try {
    const probe = runManagerVersionProbe(
      SYSTEMD_RUN_PROBE_TIMEOUT_MS,
      userManagerEnv(env, resolveCanonicalRuntimeDir(deps))
    )
    if (probe.code !== 0 || probe.timedOut || probe.stdout === undefined) {
      return null
    }
    return parseSystemdManagerVersion(probe.stdout)
  } catch {
    return null
  }
}

// Why skipped below 253: the manager cannot be newer than a client that already rejects the property.
function probeManagerForClient(clientVersion: number | null, deps: ScopeProbeDeps): number | null {
  return supportsScopeOomPolicy(clientVersion) ? probeManagerMajorVersion(deps) : null
}

/** Scope support plus whether both systemd-run and the user manager accept `OOMPolicy=`. */
export function probeDurableDaemonScope(deps: ScopeProbeDeps = {}): DurableDaemonScopeCapability {
  const client = probeScopeClient(deps)
  if (!client) {
    return { supported: false }
  }
  const managerMajorVersion = probeManagerForClient(client.systemdMajorVersion, deps)
  return {
    supported: true,
    systemdMajorVersion: client.systemdMajorVersion,
    managerMajorVersion,
    oomPolicyContinue: supportsScopeOomPolicy(managerMajorVersion)
  }
}

/** Boolean-only view; skips the manager version probe. */
export function isDurableDaemonScopeSupported(deps: ScopeProbeDeps = {}): boolean {
  return probeScopeClient(deps) !== null
}

/** The environment that reaches this user's systemd manager (see resolveUserRuntimeDir). */
export function userManagerEnv(
  env: NodeJS.ProcessEnv,
  canonicalRuntimeDir: string | null = CANONICAL_USER_RUNTIME_DIR
): NodeJS.ProcessEnv {
  const runtimeDir = resolveUserRuntimeDir(env, canonicalRuntimeDir)
  const next: NodeJS.ProcessEnv = runtimeDir ? { ...env, XDG_RUNTIME_DIR: runtimeDir } : { ...env }
  removeChromiumDisabledSessionBus(next)
  return next
}

export {
  detectOwnCgroupScopeUnit,
  isLegacyDaemonScopeUnit,
  readLegacyDaemonScopeProcesses,
  type LegacyDaemonScopeProcesses
} from './daemon-scope-cgroup-membership'

export type DurableDaemonScopeCommand = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

export function buildLegacyScopeMigrationCommand(
  launchNonce: string,
  pids: readonly number[],
  env: NodeJS.ProcessEnv,
  canonicalRuntimeDir: string | null = CANONICAL_USER_RUNTIME_DIR,
  scopeOptions: DurableDaemonScopeOptions = {}
): DurableDaemonScopeCommand {
  const oomPolicy = busctlOomPolicyProperties(scopeOptions)
  const runtimeDir = resolveUserRuntimeDir(env, canonicalRuntimeDir)
  const migrationEnv: NodeJS.ProcessEnv = runtimeDir
    ? { ...env, XDG_RUNTIME_DIR: runtimeDir }
    : { ...env }
  // busctl --user prefers this variable over XDG_RUNTIME_DIR. Service hardening commonly sets
  // it to disabled:, which would make a reachable user bus look unavailable during migration.
  delete migrationEnv.DBUS_SESSION_BUS_ADDRESS
  return {
    command: 'busctl',
    args: [
      '--user',
      'call',
      'org.freedesktop.systemd1',
      '/org/freedesktop/systemd1',
      'org.freedesktop.systemd1.Manager',
      'StartTransientUnit',
      'ssa(sv)a(sa(sv))',
      daemonScopeUnitName(launchNonce),
      'fail',
      String(1 + oomPolicy.count),
      'PIDs',
      'au',
      String(pids.length),
      ...pids.map(String),
      ...oomPolicy.args,
      '0'
    ],
    env: migrationEnv
  }
}

export function migrateLegacyDaemonScope(
  pid: number,
  launchNonce: string,
  deps: ScopeProbeDeps & {
    readProcesses?: typeof readLegacyDaemonScopeProcesses
    runMigration?: SystemdScopeMigrationRunner
  } = {}
): boolean {
  const {
    env = process.env,
    platform = process.platform,
    readProcesses = readLegacyDaemonScopeProcesses,
    runMigration = (command, timeoutMs) =>
      runProcessSync({
        program: command.command,
        args: command.args,
        env: command.env,
        timeoutMs,
        stdio: 'ignore'
      })
  } = deps
  const client = platform === 'linux' ? probeScopeClient(deps) : null
  if (!client) {
    return false
  }
  const legacy = readProcesses(pid)
  if (!legacy) {
    return false
  }
  // Why after readProcesses: adopting a healthy non-legacy daemon must not spawn systemctl.
  const oomPolicyContinue = supportsScopeOomPolicy(
    probeManagerForClient(client.systemdMajorVersion, deps)
  )
  try {
    const result = runMigration(
      buildLegacyScopeMigrationCommand(
        launchNonce,
        legacy.pids,
        env,
        resolveCanonicalRuntimeDir(deps),
        { oomPolicyContinue }
      ),
      SYSTEMD_SCOPE_MIGRATION_TIMEOUT_MS
    )
    return result.code === 0 && !result.timedOut
  } catch {
    return false
  }
}

/**
 * Wraps the daemon's real command line in `systemd-run --user --scope`, so the process that
 * ultimately execs into `execPath forkEntryPath ...scriptArgs` lands in its own transient scope
 * cgroup instead of inheriting the caller's.
 */
export function buildDurableDaemonScopeCommand(
  execPath: string,
  scriptArgs: string[],
  launchNonce: string,
  env: NodeJS.ProcessEnv,
  canonicalRuntimeDir: string | null = CANONICAL_USER_RUNTIME_DIR,
  scopeOptions: DurableDaemonScopeOptions = {}
): DurableDaemonScopeCommand {
  const runtimeDir = resolveUserRuntimeDir(env, canonicalRuntimeDir)
  const scopeEnv: NodeJS.ProcessEnv = runtimeDir
    ? { ...env, XDG_RUNTIME_DIR: runtimeDir }
    : { ...env }
  // sd-bus prefers this over XDG_RUNTIME_DIR and refuses Chromium's marker (#25580).
  removeChromiumDisabledSessionBus(scopeEnv)
  return {
    command: SYSTEMD_RUN_BINARY,
    args: [
      '--user',
      '--scope',
      `--unit=${daemonScopeUnitName(launchNonce)}`,
      '--property=TimeoutStopSec=5s',
      ...systemdRunOomPolicyArgs(scopeOptions),
      '--collect',
      '--quiet',
      '--',
      execPath,
      ...scriptArgs
    ],
    // Explicit, not inherited: the daemon must land in the same user manager the resolution
    // above just confirmed is reachable, regardless of what this spread `env`'s own
    // `XDG_RUNTIME_DIR` says (see `resolveUserRuntimeDir` for why that value can be wrong).
    env: scopeEnv
  }
}
