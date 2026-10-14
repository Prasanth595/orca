import { appendFileSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { expect } from '@stablyai/playwright-test'
import { getPiAgentStatusExtensionSource } from '../../../src/main/pi/agent-status-extension-source'
import type { AgentHookEndpoint } from '../../../src/shared/agent-hook-endpoint-file'
import { spawnProcess, runProcess } from '../../../src/shared/child-process/run-process'
import { resolveExecutableCommand } from '../../../src/shared/node-cli-command-resolution'
import type { NativeObservation } from './omp-native-observation'
import { writeOmpDeterministicRuntimeConfig } from './omp-deterministic-runtime-config'

type RpcFrame = {
  type: string
  id?: string
  success?: boolean
  data?: { cancelled?: boolean; sessionId?: string; sessionFile?: string; isSettled?: boolean }
}

export type OmpStatusRuntime = {
  directory: string
  observations: () => NativeObservation[]
  command: (type: string, fields?: Record<string, unknown>) => Promise<RpcFrame>
  release: (name: string) => Promise<void>
  resetGates: () => Promise<void>
  stop: () => Promise<void>
}

/** Runs the installed scheduler with an isolated home; only the model output is deterministic. */
export async function startOmpStatusRuntime(options: {
  directory: string
  fixtureSource: string
  rootLabel: string
  names: string[]
  endpoint: AgentHookEndpoint
  paneKey: string
  worktreeId: string
  maxConcurrency?: number
  observerEnabled?: boolean
  measurements?: boolean
  asyncChildNames?: string[]
}): Promise<OmpStatusRuntime> {
  const { directory, endpoint } = options
  const home = path.join(directory, 'home')
  const agentDir = path.join(home, '.omp', 'agent')
  const workspace = path.join(directory, 'workspace')
  const sessions = path.join(directory, 'sessions')
  const gates = path.join(directory, 'gates')
  const gateNames = [...options.names, 'root-start', 'root-finish']
  const observationPath = path.join(directory, 'native-observations.jsonl')
  const generated = path.join(directory, 'orca-agent-status.ts')
  const fixture = path.join(directory, 'deterministic-provider.ts')
  for (const folder of [
    agentDir,
    sessions,
    gates,
    path.join(workspace, '.omp', 'agents'),
    path.join(home, 'AppData', 'Roaming'),
    path.join(home, 'AppData', 'Local')
  ]) {
    await mkdir(folder, { recursive: true })
  }
  await writeFile(path.join(gates, 'root-start'), '')
  await writeFile(observationPath, '')
  await writeFile(generated, getPiAgentStatusExtensionSource('omp'))
  await writeFile(fixture, options.fixtureSource)
  await writeOmpDeterministicRuntimeConfig({
    agentDir,
    workspace,
    maxConcurrency: options.maxConcurrency,
    asyncChildNames: options.asyncChildNames
  })

  // Whitelist executable lookup/system keys, never ambient providers, credentials or Orca ownership.
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC'].includes(key.toUpperCase())
      )
    ),
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_STATE_HOME: path.join(home, 'state'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    PI_CODING_AGENT_DIR: agentDir,
    PI_NO_TITLE: '1',
    ORCA_BACKGROUND_LAUNCH: '1',
    ORCA_PANE_KEY: options.paneKey,
    ORCA_TAB_ID: options.paneKey.split(':')[0],
    ORCA_WORKTREE_ID: options.worktreeId,
    ORCA_AGENT_HOOK_PORT: String(endpoint.port),
    ORCA_AGENT_HOOK_TOKEN: endpoint.token,
    ORCA_AGENT_HOOK_ENV: endpoint.env,
    ORCA_AGENT_HOOK_VERSION: endpoint.version,
    ORCA_OMP_SMOKE_OBSERVATIONS: observationPath,
    ORCA_OMP_SMOKE_ROOT_LABEL: options.rootLabel,
    ORCA_OMP_SMOKE_GATES: gates,
    ORCA_OMP_SMOKE_MEASUREMENTS: options.measurements ? '1' : '0',
    ORCA_OMP_SMOKE_ASYNC_NAMES: JSON.stringify(options.asyncChildNames ?? []),
    ORCA_OMP_SMOKE_NAMES: JSON.stringify(options.names)
  }
  const program = resolveExecutableCommand(process.env.ORCA_OMP_PROOF_BINARY ?? 'omp', {
    pathEnv: env.PATH ?? env.Path,
    homePath: home
  })
  if (!program) {
    throw new Error('Install OMP on PATH or set ORCA_OMP_PROOF_BINARY to its absolute executable')
  }
  const version = await runProcess({
    program,
    args: ['--version'],
    cwd: workspace,
    env,
    timeoutMs: 15_000
  })
  await writeFile(path.join(directory, 'omp-version.txt'), version.stdout + version.stderr)
  if (version.code !== 0) {
    throw new Error(`Installed OMP version probe failed; see ${directory}`)
  }
  const child = spawnProcess({
    program,
    args: [
      '--mode',
      'rpc',
      '--no-ui',
      '--no-title',
      '--no-extensions',
      '--extension',
      fixture,
      ...(options.observerEnabled === false ? [] : ['--extension', generated]),
      '--no-skills',
      '--no-rules',
      '--no-lsp',
      '--session-dir',
      sessions,
      '--model',
      'orca-status-smoke/deterministic',
      '--thinking',
      'off',
      '--tools',
      'task,wait',
      '--yolo'
    ],
    cwd: workspace,
    env,
    timeoutMs: null
  })
  let failure: Error | undefined
  let serial = 0
  let closing = false
  const frames: RpcFrame[] = []
  const fail = (error: Error) => {
    failure = error
  }
  child.on('error', fail)
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', fail)
  }
  child.stderr.on('data', (chunk: Buffer) =>
    appendFileSync(path.join(directory, 'stderr.txt'), chunk)
  )
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>()
  child.once('close', () => {
    if (!closing) {
      failure ??= new Error('Installed OMP exited before smoke completion')
    }
    resolveClosed()
  })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    appendFileSync(path.join(directory, 'rpc.jsonl'), `${line}\n`)
    try {
      const frame: RpcFrame = JSON.parse(line)
      if (frame.type === 'ready' || frame.type === 'response') {
        frames.push(frame)
      }
    } catch {
      // Installed OMP may print startup diagnostics before its RPC readiness frame.
    }
  })
  const assertRunning = () => {
    if (failure) {
      throw new Error(`Installed OMP failed; see ${directory}`, { cause: failure })
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Installed OMP exited; see ${directory}`)
    }
  }
  const stop = async () => {
    closing = true
    if (options.asyncChildNames?.length) {
      // Real native bash jobs must not outlive a failed assertion or their owning OMP process.
      await Promise.all(
        options.asyncChildNames.map((name) => writeFile(path.join(gates, name), ''))
      )
      await expect
        .poll(
          () => {
            const rows: NativeObservation[] = readFileSync(observationPath, 'utf8')
              .split('\n')
              .slice(0, -1)
              .map((line) => JSON.parse(line))
            return !rows
              .findLast((row) => row.kind === 'registry')
              ?.refs?.some((ref) => ref.pendingAsync)
          },
          { timeout: 5_000 }
        )
        .toBe(true)
        .catch(() => undefined)
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
      await closed
    } finally {
      clearTimeout(timer)
      lines.close()
    }
  }
  try {
    await expect
      .poll(
        () => {
          assertRunning()
          return frames.some((frame) => frame.type === 'ready')
        },
        { timeout: 30_000, message: `Installed OMP never became RPC-ready; see ${directory}` }
      )
      .toBe(true)
  } catch (error) {
    await stop()
    throw error
  }
  return {
    directory,
    observations: (): NativeObservation[] => {
      assertRunning()
      return readFileSync(observationPath, 'utf8')
        .split('\n')
        .slice(0, -1)
        .map((line) => JSON.parse(line))
    },
    command: async (type: string, fields: Record<string, unknown> = {}) => {
      assertRunning()
      const id = `omp-status-smoke-${++serial}`
      child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`)
      await expect
        .poll(
          () => {
            assertRunning()
            return frames.find((frame) => frame.type === 'response' && frame.id === id)
          },
          { timeout: 15_000, message: `No OMP RPC response for ${type}; see ${directory}` }
        )
        .toBeDefined()
      const response = frames.find((frame) => frame.type === 'response' && frame.id === id)
      if (!response?.success) {
        throw new Error(`OMP RPC ${type} failed; see ${directory}`)
      }
      return response
    },
    release: async (name: string) => {
      if (!gateNames.includes(name)) {
        throw new Error(`Unknown native smoke gate: ${name}`)
      }
      await writeFile(path.join(gates, name), '')
    },
    resetGates: async () => {
      await Promise.all(gateNames.map((name) => rm(path.join(gates, name), { force: true })))
    },
    stop
  }
}
