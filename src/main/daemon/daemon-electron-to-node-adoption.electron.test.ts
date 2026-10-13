/**
 * A daemon the previous build started under Electron (`ELECTRON_RUN_AS_NODE`) must survive a
 * launcher whose daemons run on plain Node: a busy one is adopted with its terminals intact, and
 * only once it has retired on its own does a Node daemon take the endpoint. Linux only, where the
 * AppImage moves its daemon from Electron to the bundled Node.
 */
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runProcess, spawnProcess } from '@orca/process-host'
import {
  buildDaemonLauncherDriver,
  type DaemonLauncherDriverResult
} from './daemon-launcher-driver-fixture'
import {
  buildDaemonSessionClient,
  type DaemonSessionClientResult
} from '../orcad/orcad-daemon-session-client-fixture'
import {
  killAndAwaitExit,
  killProfileDaemons,
  removeTestRoot
} from '../orcad/orcad-daemon-teardown-fixture'
import { locatePinnedNodeForTests } from '../orcad/orcad-node-slot-fixture'
import { readDaemonPidRecord } from './daemon-endpoint-incarnation'
import { getDaemonPidPath } from './daemon-spawner'

type Runtime = 'electron' | 'node'

const requireFromTest = createRequire(import.meta.url)
const linux = process.platform === 'linux'
let root = ''
let launcher = ''
let client = ''
let appPath = ''
const runtimes: Record<Runtime, string> = { electron: '', node: '' }
const shells = new Set<number>()
const profiles = new Set<string>()

/** Without Vitest's markers: daemon-entry does not start its server under VITEST. */
function hostEnv(runtime: Runtime): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV')
    ),
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_DIAGNOSTICS_DISABLED: '1'
  }
  delete env.ELECTRON_RUN_AS_NODE
  return runtime === 'electron' ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env
}

/** Runs the launcher as a window would, and keeps it connected until `quit`, as a window stays. */
async function openWindow(
  runtime: Runtime,
  userData: string,
  appVersion: string
): Promise<{ result: DaemonLauncherDriverResult; quit: () => Promise<void> }> {
  const child = spawnProcess({
    program: runtimes[runtime],
    args: [launcher, userData, appPath, appVersion],
    env: hostEnv(runtime),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  let stdout = ''
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const line = await new Promise<string>((settle, reject) => {
    const timer = setTimeout(() => reject(new Error(`launcher timed out: ${stderr}`)), 60_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const newline = stdout.indexOf('\n')
      if (newline !== -1) {
        clearTimeout(timer)
        settle(stdout.slice(0, newline))
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`launcher exited ${code}: ${stderr}`))
    })
  })
  const result: DaemonLauncherDriverResult = JSON.parse(line)
  return {
    result,
    quit: async () => {
      child.stdin?.end()
      await exited
    }
  }
}

async function session(
  op: 'create' | 'attach',
  userData: string,
  sessionId: string,
  marker: string
): Promise<DaemonSessionClientResult> {
  const result = await runProcess({
    program: runtimes.node,
    args: [client, op, join(userData, 'daemon'), sessionId, marker, root],
    env: hostEnv('node'),
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  const parsed: DaemonSessionClientResult = JSON.parse(
    result.stdout.trim().split('\n').at(-1) ?? ''
  )
  shells.add(parsed.pid)
  return parsed
}

function daemonPid(userData: string): number | null {
  return readDaemonPidRecord(getDaemonPidPath(join(userData, 'daemon')))?.pid ?? null
}

function executableOf(pid: number): string {
  return realpathSync(readlinkSync(`/proc/${pid}/exe`))
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function newProfile(name: string): string {
  const userData = join(root, name)
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  profiles.add(userData)
  return userData
}

describe.runIf(linux)('an Electron-hosted daemon meeting a Node-hosted launcher', () => {
  beforeAll(async () => {
    const electron: unknown = requireFromTest('electron')
    if (typeof electron !== 'string') {
      throw new Error('The Electron executable is unavailable')
    }
    runtimes.electron = realpathSync(electron)
    runtimes.node = realpathSync(locatePinnedNodeForTests() ?? process.execPath)
    // Short root: the daemon's socket must fit sun_path.
    root = realpathSync(mkdtempSync('/tmp/orca-e2n-'))
    appPath = join(root, 'app')
    launcher = join(root, 'launcher.cjs')
    client = join(root, 'client.cjs')
    await Promise.all([
      build({
        entryPoints: [join(__dirname, 'daemon-entry.ts')],
        outfile: join(appPath, 'daemon-entry.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        external: ['electron', 'node-pty', '@parcel/watcher', '*.node'],
        logLevel: 'silent'
      }),
      buildDaemonLauncherDriver(launcher),
      buildDaemonSessionClient(client)
    ])
    // The packaged layout: node-pty beside the entry, loaded by whichever runtime hosts it.
    mkdirSync(join(appPath, 'node_modules'), { recursive: true })
    symlinkSync(
      dirname(realpathSync(requireFromTest.resolve('node-pty/package.json'))),
      join(appPath, 'node_modules', 'node-pty')
    )
  }, 120_000)

  afterEach(async () => {
    await killAndAwaitExit(shells)
    shells.clear()
    for (const userData of profiles) {
      await killProfileDaemons(userData)
    }
    profiles.clear()
  })

  afterAll(async () => {
    if (root) {
      await removeTestRoot(root)
    }
  })

  it.for([
    ['the same build', '1.0.0'],
    ['an upgraded build', '1.1.0']
  ] as const)(
    'keeps a busy Electron daemon and its terminal when %s relaunches on Node',
    { timeout: 120_000 },
    async ([, nextVersion]) => {
      const userData = newProfile(`busy-${nextVersion}`)
      const previous = await openWindow('electron', userData, '1.0.0')
      expect(previous.result).toEqual({ adopted: false, mode: null })
      const pid = daemonPid(userData)
      expect(pid).not.toBeNull()
      expect(executableOf(pid!)).toBe(runtimes.electron)

      const created = await session('create', userData, 'e2n-live', 'BEFORE')
      expect(created).toMatchObject({ isReattach: false, output: true })
      await previous.quit()
      expect(isAlive(pid!)).toBe(true)

      const next = await openWindow('node', userData, nextVersion)
      // Adopted as a normal target, never replaced or quarantined, while it owns a live shell.
      expect(next.result).toEqual({ adopted: true, mode: null })
      expect(daemonPid(userData)).toBe(pid)
      expect(isAlive(created.pid)).toBe(true)
      const attached = await session('attach', userData, 'e2n-live', 'AFTER')
      expect(attached).toEqual({ pid: created.pid, isReattach: true, output: true })
      await next.quit()
      expect(isAlive(pid!)).toBe(true)
    }
  )

  it(
    'starts the next daemon on Node once the Electron daemon has retired',
    { timeout: 120_000 },
    async () => {
      const userData = newProfile('retired')
      const previous = await openWindow('electron', userData, '1.0.0')
      const oldPid = daemonPid(userData)
      expect(oldPid).not.toBeNull()
      await previous.quit()
      // An idle daemon leaves with its last client, as when the old window quits with no terminals.
      await vi.waitFor(() => expect(isAlive(oldPid!)).toBe(false), { timeout: 30_000 })

      const next = await openWindow('node', userData, '1.1.0')
      expect(next.result).toEqual({ adopted: false, mode: null })
      const newPid = daemonPid(userData)
      expect(newPid).not.toBe(oldPid)
      expect(executableOf(newPid!)).toBe(runtimes.node)
      expect(await session('create', userData, 'e2n-fresh', 'FRESH')).toMatchObject({
        isReattach: false,
        output: true
      })
      await next.quit()
    }
  )
})
