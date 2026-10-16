import { spawnProcess } from '@orca/process-host'
import { resolveWindowsCmdShim } from '@orca/process-host/windows-cmd-shim-resolution'
import { isCmdInterpretedProgram } from '@orca/process-host/windows-command-line'
import { withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { resolveCliCommand } from '../codex-cli/command'
import { createProviderSpawnSpec } from '../provider-process/provider-process-supervisor'
import { wslAwareSpawn } from '../git/runner'
import { UnsafeWindowsBatchArgumentsError } from '../win32-utils'
import type {
  SourceControlAgentSpawnInput,
  SpawnedSourceControlAgentProcess,
  SpawnSourceControlAgent
} from './source-control-text-generation-types'

const WSL_LAUNCHER_ENV_KEYS = [
  'ComSpec',
  'COMSPEC',
  'Path',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'WINDIR'
] as const

function buildWslLauncherEnv(explicitEnv: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of WSL_LAUNCHER_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  for (const [key, value] of Object.entries(explicitEnv ?? {})) {
    if (value !== undefined && value !== process.env[key]) {
      env[key] = value
    }
  }
  return env
}

export const spawnSourceControlAgent: SpawnSourceControlAgent = (input) => {
  const spawnEnv = input.env ?? process.env
  if (process.platform === 'win32' && input.wslDistro) {
    // Apply assignments in the guest after its login shell, not to the Windows launcher.
    const assignments = Object.entries(input.commandEnv ?? {}).map(
      ([key, value]) => `${key}=${value}`
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: WSL spawn pipes both output streams and supplies the configured stdin stream.
    return wslAwareSpawn(
      assignments.length ? '/usr/bin/env' : input.binary,
      assignments.length ? [...assignments, input.binary, ...input.args] : input.args,
      {
        cwd: input.cwd,
        env: buildWslLauncherEnv(input.env),
        stdio: [input.stdinMode, 'pipe', 'pipe'],
        windowsHide: true,
        wslDistro: input.wslDistro,
        useWslLoginShell: true
      }
    ) as SpawnedSourceControlAgentProcess
  }
  const child =
    process.platform === 'win32'
      ? spawnWindowsAgent(input, spawnEnv)
      : spawnSupervisedAgent(input, spawnEnv)
  if (input.stdinMode === 'ignore') {
    child.stdin?.on?.('error', () => {})
    child.stdin?.end()
  }
  return child
}

function spawnWindowsAgent(
  input: SourceControlAgentSpawnInput,
  spawnEnv: NodeJS.ProcessEnv
): SpawnedSourceControlAgentProcess {
  const resolvedBinary = resolveCliCommand(input.binary, {
    pathEnv: spawnEnv.PATH ?? spawnEnv.Path ?? null
  })
  const env = withCliRuntimeOnPath(resolvedBinary, spawnEnv)
  // Why the .cmd goes straight to process-host: it runs an npm/pnpm shim's own
  // node.exe, so a multi-line prompt survives, and encodes other batch files for cmd.exe.
  try {
    return spawnProcess({
      program: resolvedBinary,
      args: input.args,
      env,
      ...(input.useCwdForNative ? { cwd: input.cwd } : {})
    })
  } catch (error) {
    if (isRefusedBatchFileLineBreak(resolvedBinary, input.args, env)) {
      throw new UnsafeWindowsBatchArgumentsError()
    }
    throw error
  }
}

// Mirrors process-host's routing: a batch file it cannot resolve runs under
// cmd.exe, which ends the command at a line break, so it refuses one.
function isRefusedBatchFileLineBreak(
  program: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): boolean {
  return (
    isCmdInterpretedProgram(program) &&
    args.some((arg) => /[\r\n]/.test(arg)) &&
    resolveWindowsCmdShim(program, env) === null
  )
}

// Under the provider supervisor, an Orca that quits or dies mid-run still stops the agent's group.
function spawnSupervisedAgent(
  input: SourceControlAgentSpawnInput,
  spawnEnv: NodeJS.ProcessEnv
): SpawnedSourceControlAgentProcess {
  const spec = createProviderSpawnSpec(
    {
      command: input.binary,
      args: input.args,
      ...(input.useCwdForNative && input.cwd !== undefined ? { cwd: input.cwd } : {})
    },
    withCliRuntimeOnPath(input.binary, spawnEnv),
    process.platform,
    { lifetime: 'one-shot' }
  )
  const child = spawnProcess({
    program: spec.program,
    args: spec.args,
    env: spec.env,
    cwd: spec.cwd,
    detached: spec.detached,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  return Object.assign(child, { supervised: spec.supervised })
}
