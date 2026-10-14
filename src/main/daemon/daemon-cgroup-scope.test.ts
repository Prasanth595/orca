import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildLegacyScopeMigrationCommand,
  buildDurableDaemonScopeCommand,
  daemonScopeUnitName,
  detectOwnCgroupScopeUnit,
  isDurableDaemonScopeSupported,
  probeDurableDaemonScope,
  migrateLegacyDaemonScope,
  readLegacyDaemonScopeProcesses
} from './daemon-cgroup-scope'

describe('daemonScopeUnitName', () => {
  it('prefixes the launch nonce so the unit is traceable back to a launch', () => {
    expect(daemonScopeUnitName('c0ffee12-3456-7890-abcd-ef0123456789')).toBe(
      'orca-daemon-c0ffee12-3456-7890-abcd-ef0123456789.scope'
    )
  })

  it('sanitizes characters systemd unit names reject', () => {
    expect(daemonScopeUnitName('weird nonce/with:stuff')).toBe(
      'orca-daemon-weird-nonce-with:stuff.scope'
    )
  })
})

// Real, connectable AF_UNIX sockets rather than plain files at "bus" — the fix under test
// distinguishes a genuinely reachable bus from a stale file/directory left at that path, so a
// fixture that only `existsSync`-passes would not exercise it.
const fakeBusServers: Server[] = []
const fakeBusDirs: string[] = []
const fakeSystemdBootDirs: string[] = []

function fakeRuntimeDirWithBus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xdg-runtime-with-bus-'))
  const server = createServer()
  server.listen(join(dir, 'bus'))
  fakeBusServers.push(server)
  fakeBusDirs.push(dir)
  return dir
}

function fakeRuntimeDirWithoutBus(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xdg-runtime-no-bus-'))
  fakeBusDirs.push(dir)
  return dir
}

// A directory that reliably exists on every dev host, standing in for the real
// `/run/systemd/system` boot marker that only exists on a systemd host.
function fakeSystemdBootPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'systemd-boot-marker-'))
  fakeSystemdBootDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const server of fakeBusServers.splice(0)) {
    server.close()
  }
  for (const dir of fakeBusDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  for (const dir of fakeSystemdBootDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('isDurableDaemonScopeSupported', () => {
  it('is false on non-Linux platforms regardless of environment', () => {
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: '/run/user/1000' },
        platform: 'darwin'
      })
    ).toBe(false)
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: '/run/user/1000' },
        platform: 'win32'
      })
    ).toBe(false)
  })

  it('is false when not booted under systemd, even with a reachable bus and a working binary', () => {
    const perUidDir = fakeRuntimeDirWithBus()
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: perUidDir },
        platform: 'linux',
        canonicalRuntimeDir: perUidDir,
        systemdBootPath: '/definitely/not/systemd-boot',
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(false)
  })

  it('is false when there is no runtime dir to resolve at all', () => {
    expect(
      isDurableDaemonScopeSupported({
        env: {},
        platform: 'linux',
        canonicalRuntimeDir: null,
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(false)
  })

  it('is false when neither the canonical per-UID path nor the env path has a reachable bus', () => {
    const canonical = fakeRuntimeDirWithoutBus()
    const envDir = fakeRuntimeDirWithoutBus()
    // Neither fixture has a `bus` socket written — the probe must fail closed regardless of
    // which path it looks at first.
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: envDir },
        platform: 'linux',
        canonicalRuntimeDir: canonical,
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(false)
  })

  it('is false when systemd-run --version cannot answer: non-zero exit or a timeout kill', () => {
    const perUidDir = fakeRuntimeDirWithBus()
    const bootPath = fakeSystemdBootPath()
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: perUidDir },
        platform: 'linux',
        canonicalRuntimeDir: perUidDir,
        systemdBootPath: bootPath,
        runVersionProbe: () => ({ code: 1, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(false)
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: perUidDir },
        platform: 'linux',
        canonicalRuntimeDir: perUidDir,
        systemdBootPath: bootPath,
        runVersionProbe: () => ({ code: null, timedOut: true }),
        outlivesCaller: () => true
      })
    ).toBe(false)
  })

  it('is true when the process env XDG_RUNTIME_DIR is a hardened unit override, but the real per-UID dir has a reachable bus (mtl-02 regression)', () => {
    // Simulates orca-serve@factory.service's RuntimeDirectory=factory hardening directive:
    // the process's own XDG_RUNTIME_DIR points at a private scratch dir that is NOT the user
    // session bus location, while the real per-UID runtime dir (injected here in place of the
    // real /run/user/<uid>) has a genuinely reachable bus the whole time.
    const hardenedOverrideDir = fakeRuntimeDirWithoutBus()
    const realPerUidDir = fakeRuntimeDirWithBus()
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: hardenedOverrideDir },
        platform: 'linux',
        canonicalRuntimeDir: realPerUidDir,
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(true)
  })

  it('is true when the caller env XDG_RUNTIME_DIR already points at the correct, reachable per-UID bus', () => {
    const perUidDir = fakeRuntimeDirWithBus()
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: perUidDir },
        platform: 'linux',
        canonicalRuntimeDir: perUidDir,
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(true)
  })

  it('falls back to the process env XDG_RUNTIME_DIR when the canonical per-UID path has no reachable bus', () => {
    // Some hosts legitimately have no /run/user/<uid> at all but do have a working bus
    // wherever their own environment points — the probe must still support that host.
    const canonicalWithoutBus = fakeRuntimeDirWithoutBus()
    const envDirWithBus = fakeRuntimeDirWithBus()
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: envDirWithBus },
        platform: 'linux',
        canonicalRuntimeDir: canonicalWithoutBus,
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(true)
  })
})

describe('buildDurableDaemonScopeCommand', () => {
  it('wraps the daemon command in systemd-run --user --scope with a collected unit', () => {
    const result = buildDurableDaemonScopeCommand(
      '/usr/bin/node',
      ['/opt/orca/daemon-entry.js', '--socket', '/tmp/x.sock'],
      'nonce-1',
      { PATH: '/usr/bin' },
      null
    )
    expect(result.command).toBe('systemd-run')
    expect(result.args).toEqual([
      '--user',
      '--scope',
      '--unit=orca-daemon-nonce-1.scope',
      '--property=TimeoutStopSec=5s',
      '--collect',
      '--quiet',
      '--',
      '/usr/bin/node',
      '/opt/orca/daemon-entry.js',
      '--socket',
      '/tmp/x.sock'
    ])
  })

  it('prefers the canonical per-UID runtime dir over a hardened unit-overridden XDG_RUNTIME_DIR (mtl-02 regression)', () => {
    const hardenedOverrideDir = fakeRuntimeDirWithoutBus()
    const realPerUidDir = fakeRuntimeDirWithBus()
    const result = buildDurableDaemonScopeCommand(
      '/usr/bin/node',
      [],
      'n',
      { PATH: '/bin', XDG_RUNTIME_DIR: hardenedOverrideDir },
      realPerUidDir
    )
    // Explicitly the real per-UID dir, not inherited from the spread env's overridden value.
    expect(result.env.XDG_RUNTIME_DIR).toBe(realPerUidDir)
  })

  it('falls back to the caller XDG_RUNTIME_DIR when the canonical per-UID path has no reachable bus', () => {
    const canonicalWithoutBus = fakeRuntimeDirWithoutBus()
    const envDirWithBus = fakeRuntimeDirWithBus()
    const result = buildDurableDaemonScopeCommand(
      '/usr/bin/node',
      [],
      'n',
      { PATH: '/bin', XDG_RUNTIME_DIR: envDirWithBus },
      canonicalWithoutBus
    )
    expect(result.env.XDG_RUNTIME_DIR).toBe(envDirWithBus)
  })

  it('computes the conventional /run/user/<uid> runtime dir when the caller env omits it', () => {
    const perUidDir = fakeRuntimeDirWithBus()
    const result = buildDurableDaemonScopeCommand(
      '/usr/bin/node',
      [],
      'n',
      { PATH: '/bin' },
      perUidDir
    )
    expect(result.env.XDG_RUNTIME_DIR).toBe(perUidDir)
  })
})

describe('probeDurableDaemonScope', () => {
  function probeDeps(
    runVersionProbe: () => { code: number | null; timedOut: boolean; stdout?: string },
    runManagerVersionProbe?: (
      timeoutMs: number,
      env: NodeJS.ProcessEnv
    ) => { code: number | null; timedOut: boolean; stdout?: string }
  ) {
    const perUidDir = fakeRuntimeDirWithBus()
    return {
      env: { XDG_RUNTIME_DIR: perUidDir },
      platform: 'linux' as const,
      canonicalRuntimeDir: perUidDir,
      systemdBootPath: fakeSystemdBootPath(),
      runVersionProbe,
      runManagerVersionProbe,
      outlivesCaller: () => true
    }
  }
  const client = (v: number) => () => ({
    code: 0,
    timedOut: false,
    stdout: `systemd ${v} (${v}.1)\n+PAM`
  })
  const manager = (stdout: string) => () => ({ code: 0, timedOut: false, stdout })

  it('enables OOMPolicy when client and manager are both >= 253', () => {
    expect(probeDurableDaemonScope(probeDeps(client(255), manager('259.5-0ubuntu3.4\n')))).toEqual({
      supported: true,
      systemdMajorVersion: 255,
      managerMajorVersion: 259,
      oomPolicyContinue: true
    })
  })

  it('omits OOMPolicy when the manager is older than the client', () => {
    expect(probeDurableDaemonScope(probeDeps(client(255), manager('249.11\n')))).toMatchObject({
      supported: true,
      managerMajorVersion: 249,
      oomPolicyContinue: false
    })
  })

  it('probes the manager with the timeout and the canonical runtime dir', () => {
    const managerProbe = vi.fn((_timeoutMs: number, _env: NodeJS.ProcessEnv) => ({
      code: 0,
      timedOut: false,
      stdout: '259'
    }))
    const deps = probeDeps(client(255), managerProbe)
    probeDurableDaemonScope({ ...deps, env: { XDG_RUNTIME_DIR: '/run/user/other' } })
    expect(managerProbe).toHaveBeenCalledTimes(1)
    const [timeoutMs, env] = managerProbe.mock.calls[0]
    expect(timeoutMs).toBe(2000)
    expect(env.XDG_RUNTIME_DIR).toBe(deps.canonicalRuntimeDir)
  })

  it('skips the manager probe for an old client', () => {
    const managerProbe = vi.fn(manager('259'))
    expect(probeDurableDaemonScope(probeDeps(client(245), managerProbe))).toMatchObject({
      supported: true,
      systemdMajorVersion: 245,
      managerMajorVersion: null,
      oomPolicyContinue: false
    })
    expect(managerProbe).not.toHaveBeenCalled()
  })

  it('keeps the scope when the manager probe throws, times out, or is unparsable', () => {
    const throwing = () => {
      throw new Error('no systemctl')
    }
    for (const probe of [
      throwing,
      () => ({ code: null, timedOut: true }),
      () => ({ code: 1, timedOut: false, stdout: '' }),
      manager('garbage')
    ]) {
      expect(probeDurableDaemonScope(probeDeps(client(255), probe))).toMatchObject({
        supported: true,
        managerMajorVersion: null,
        oomPolicyContinue: false
      })
    }
  })

  it('treats a stub without stdout as supported with unknown versions', () => {
    const managerProbe = vi.fn(manager('259'))
    expect(
      probeDurableDaemonScope(probeDeps(() => ({ code: 0, timedOut: false }), managerProbe))
    ).toEqual({
      supported: true,
      systemdMajorVersion: null,
      managerMajorVersion: null,
      oomPolicyContinue: false
    })
    expect(managerProbe).not.toHaveBeenCalled()
  })

  it('is unsupported when the client probe fails, and the boolean wrapper never probes the manager', () => {
    const managerProbe = vi.fn(manager('259'))
    expect(
      probeDurableDaemonScope(probeDeps(() => ({ code: 1, timedOut: false }), managerProbe))
    ).toEqual({ supported: false })
    expect(isDurableDaemonScopeSupported(probeDeps(client(255), managerProbe))).toBe(true)
    expect(managerProbe).not.toHaveBeenCalled()
  })
})

describe('OOMPolicy in scope commands', () => {
  it('places the systemd-run property right after TimeoutStopSec only when on', () => {
    const on = buildDurableDaemonScopeCommand('/n', [], 'x', {}, null, { oomPolicyContinue: true })
    expect(on.args.slice(3, 6)).toEqual([
      '--property=TimeoutStopSec=5s',
      '--property=OOMPolicy=continue',
      '--collect'
    ])
    const off = buildDurableDaemonScopeCommand('/n', [], 'x', {}, null, {})
    expect(off.args.join(' ')).not.toContain('OOMPolicy')
  })

  it('adds a second busctl property to the legacy migration call', () => {
    const on = buildLegacyScopeMigrationCommand('x', [1, 2], {}, null, { oomPolicyContinue: true })
    expect(on.args.slice(9)).toEqual([
      '2',
      'PIDs',
      'au',
      '2',
      '1',
      '2',
      'OOMPolicy',
      's',
      'continue',
      '0'
    ])
    const off = buildLegacyScopeMigrationCommand('x', [1, 2], {}, null)
    expect(off.args.slice(9)).toEqual(['1', 'PIDs', 'au', '2', '1', '2', '0'])
  })

  it('migrateLegacyDaemonScope applies the probed policy', () => {
    const runtimeDir = fakeRuntimeDirWithBus()
    const run = (managerVersion: string) => {
      let migrationArgs: string[] = []
      const ok = migrateLegacyDaemonScope(321, 'n', {
        env: { XDG_RUNTIME_DIR: runtimeDir },
        platform: 'linux',
        canonicalRuntimeDir: runtimeDir,
        readProcesses: () => ({ unit: 'app-orca-1.scope', pids: [321] }),
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false, stdout: 'systemd 255 (255)\n' }),
        runManagerVersionProbe: () => ({ code: 0, timedOut: false, stdout: managerVersion }),
        runMigration: (command) => {
          migrationArgs = command.args
          return { code: 0, timedOut: false }
        },
        outlivesCaller: () => true
      })
      return { ok, args: migrationArgs }
    }
    const on = run('259.5')
    expect(on.ok).toBe(true)
    expect(on.args).toContain('OOMPolicy')
    expect(run('249').args).not.toContain('OOMPolicy')
  })

  it('migrateLegacyDaemonScope skips the manager probe for a non-legacy daemon', () => {
    const runtimeDir = fakeRuntimeDirWithBus()
    const managerProbe = vi.fn(() => ({ code: 0, timedOut: false, stdout: '259' }))
    const ok = migrateLegacyDaemonScope(321, 'n', {
      env: { XDG_RUNTIME_DIR: runtimeDir },
      platform: 'linux',
      canonicalRuntimeDir: runtimeDir,
      readProcesses: () => null,
      systemdBootPath: fakeSystemdBootPath(),
      runVersionProbe: () => ({ code: 0, timedOut: false, stdout: 'systemd 255 (255)\n' }),
      runManagerVersionProbe: managerProbe,
      outlivesCaller: () => true
    })
    expect(ok).toBe(false)
    expect(managerProbe).not.toHaveBeenCalled()
  })
})

describe('detectOwnCgroupScopeUnit', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function writeCgroupFixture(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cgroup-scope-'))
    const path = join(dir, 'cgroup')
    writeFileSync(path, contents)
    tempDirs.push(dir)
    return path
  }

  it('is null on non-Linux platforms without reading any file', () => {
    expect(detectOwnCgroupScopeUnit('darwin', '/nonexistent')).toBeNull()
    expect(detectOwnCgroupScopeUnit('win32', '/nonexistent')).toBeNull()
  })

  it('is null when the cgroup file cannot be read', () => {
    expect(detectOwnCgroupScopeUnit('linux', '/definitely/absent/cgroup')).toBeNull()
  })

  it('parses a v2 unified-hierarchy line naming an orca-daemon scope', () => {
    const path = writeCgroupFixture('0::/user.slice/user-1000.slice/orca-daemon-abc123.scope\n')
    expect(detectOwnCgroupScopeUnit('linux', path)).toBe('orca-daemon-abc123.scope')
  })

  it('parses a v1 systemd-controller line naming an orca-daemon scope', () => {
    const path = writeCgroupFixture(
      '1:name=systemd:/user.slice/user-1000.slice/orca-daemon-def456.scope\n'
    )
    expect(detectOwnCgroupScopeUnit('linux', path)).toBe('orca-daemon-def456.scope')
  })

  it('returns null for a plain service-unit cgroup — the un-isolated case this fix targets', () => {
    const path = writeCgroupFixture('0::/system.slice/orca-serve@factory.service\n')
    expect(detectOwnCgroupScopeUnit('linux', path)).toBeNull()
  })

  it('returns null for a scope unit that is not an orca-daemon one', () => {
    const path = writeCgroupFixture('0::/user.slice/user-1000.slice/some-other-app.scope\n')
    expect(detectOwnCgroupScopeUnit('linux', path)).toBeNull()
  })

  it('recognizes a legacy app-orca scope so an adopted daemon can migrate it', () => {
    const path = writeCgroupFixture('0::/user.slice/user-1000.slice/app-orca-1420296.scope\n')
    expect(detectOwnCgroupScopeUnit('linux', path)).toBe('app-orca-1420296.scope')
  })
})

describe('legacy daemon scope migration', () => {
  it('reads every process in the legacy scope, including detached descendants', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-scope-migration-'))
    const procDir = join(root, 'proc', '321')
    const cgroupDir = join(root, 'sys', 'user.slice', 'app-orca-1420296.scope')
    mkdirSync(join(procDir), { recursive: true })
    mkdirSync(cgroupDir, { recursive: true })
    writeFileSync(join(procDir, 'cgroup'), '0::/user.slice/app-orca-1420296.scope\n')
    writeFileSync(join(cgroupDir, 'cgroup.procs'), '321\n400\n401\n')
    expect(readLegacyDaemonScopeProcesses(321, join(root, 'proc'), join(root, 'sys'))).toEqual({
      unit: 'app-orca-1420296.scope',
      pids: [321, 400, 401]
    })
    rmSync(root, { recursive: true, force: true })
  })

  it('builds a user-bus StartTransientUnit call containing the whole old scope', () => {
    const command = buildLegacyScopeMigrationCommand(
      'new-nonce',
      [321, 400, 401],
      { XDG_RUNTIME_DIR: '/run/user/1000' },
      null
    )
    expect(command).toEqual({
      command: 'busctl',
      args: [
        '--user',
        'call',
        'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager',
        'StartTransientUnit',
        'ssa(sv)a(sa(sv))',
        'orca-daemon-new-nonce.scope',
        'fail',
        '1',
        'PIDs',
        'au',
        '3',
        '321',
        '400',
        '401',
        '0'
      ],
      env: { XDG_RUNTIME_DIR: '/run/user/1000' }
    })
  })

  it('lets busctl discover the resolved user bus when service hardening disables the inherited address', () => {
    const runtimeDir = fakeRuntimeDirWithBus()
    const command = buildLegacyScopeMigrationCommand(
      'disabled-address',
      [321],
      {
        XDG_RUNTIME_DIR: '/run/orca_serve/factory',
        DBUS_SESSION_BUS_ADDRESS: 'disabled:'
      },
      runtimeDir
    )

    expect(command.env).toEqual({ XDG_RUNTIME_DIR: runtimeDir })
  })

  it('migrates only a proven legacy scope and fails closed when systemd rejects it', () => {
    const runtimeDir = fakeRuntimeDirWithBus()
    const runMigration = vi.fn(() => ({ code: 0, timedOut: false }))
    const migrated = migrateLegacyDaemonScope(321, 'new-nonce', {
      env: { XDG_RUNTIME_DIR: runtimeDir },
      platform: 'linux',
      canonicalRuntimeDir: runtimeDir,
      readProcesses: () => ({ unit: 'app-orca-1420296.scope', pids: [321, 400] }),
      systemdBootPath: fakeSystemdBootPath(),
      runVersionProbe: () => ({ code: 0, timedOut: false }),
      runMigration: runMigration,
      outlivesCaller: () => true
    })
    expect(migrated).toBe(true)
    expect(runMigration).toHaveBeenCalledOnce()
    expect(
      migrateLegacyDaemonScope(321, 'new-nonce', {
        env: { XDG_RUNTIME_DIR: runtimeDir },
        platform: 'linux',
        canonicalRuntimeDir: runtimeDir,
        readProcesses: () => ({ unit: 'app-orca-1420296.scope', pids: [321, 400] }),
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        runMigration: () => ({ code: 1, timedOut: false }),
        outlivesCaller: () => true
      })
    ).toBe(false)
  })
})

describe('durable scope launch environment and lifetime (#25580, #24201)', () => {
  it("drops Chromium's disabled: bus marker so systemd-run reaches the user manager", () => {
    const perUidDir = fakeRuntimeDirWithBus()
    const result = buildDurableDaemonScopeCommand(
      '/usr/bin/node',
      [],
      'n',
      { PATH: '/bin', DBUS_SESSION_BUS_ADDRESS: 'disabled:' },
      perUidDir
    )
    expect(result.env).not.toHaveProperty('DBUS_SESSION_BUS_ADDRESS')
    expect(result.env.XDG_RUNTIME_DIR).toBe(perUidDir)
  })

  it('keeps a real session bus address', () => {
    const result = buildDurableDaemonScopeCommand(
      '/usr/bin/node',
      [],
      'n',
      { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
      null
    )
    expect(result.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus')
  })

  it('refuses the scope when the user manager would not outlive the caller', () => {
    const perUidDir = fakeRuntimeDirWithBus()
    const versionProbe = vi.fn(() => ({ code: 0, timedOut: false }))
    expect(
      isDurableDaemonScopeSupported({
        env: { XDG_RUNTIME_DIR: perUidDir },
        platform: 'linux',
        canonicalRuntimeDir: perUidDir,
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: versionProbe,
        outlivesCaller: () => false
      })
    ).toBe(false)
    expect(versionProbe).not.toHaveBeenCalled()
  })

  it('never migrates an adopted daemon into a manager that dies at logout', () => {
    const runtimeDir = fakeRuntimeDirWithBus()
    const runMigration = vi.fn(() => ({ code: 0, timedOut: false }))
    expect(
      migrateLegacyDaemonScope(321, 'new-nonce', {
        env: { XDG_RUNTIME_DIR: runtimeDir },
        platform: 'linux',
        canonicalRuntimeDir: runtimeDir,
        readProcesses: () => ({ unit: 'app-orca-1.scope', pids: [321] }),
        systemdBootPath: fakeSystemdBootPath(),
        runVersionProbe: () => ({ code: 0, timedOut: false }),
        runMigration: runMigration,
        outlivesCaller: () => false
      })
    ).toBe(false)
    expect(runMigration).not.toHaveBeenCalled()
  })
})
