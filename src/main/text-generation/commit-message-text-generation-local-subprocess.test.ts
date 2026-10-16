import { spawn } from 'node:child_process'
import type * as ChildProcess from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateCommitMessageFromContext } from './commit-message-text-generation'
import {
  createChildTerminationExpectation,
  withPlatform
} from './commit-message-text-generation-test-harness'

const { terminateWindowsProcessTreeMock } = vi.hoisted(() => ({
  terminateWindowsProcessTreeMock: vi.fn(async () => {})
}))

vi.mock('../windows-process-tree-kill', () => ({
  terminateWindowsProcessTree: terminateWindowsProcessTreeMock
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>()
  return {
    ...actual,
    spawn: vi.fn(actual.spawn)
  }
})

const spawnMock = vi.mocked(spawn)

const expectChildTerminated = createChildTerminationExpectation(terminateWindowsProcessTreeMock)

// These suites drive fake children down the Windows direct-child path, taskkill included. The POSIX
// supervised stop with the Codex home lock (generation: timeout, cancel, output limit; discovery:
// timeout, output limit) is in source-control-local-process.test.ts.
const hostPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: hostPlatform })
  vi.unstubAllEnvs()
})

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  // Windows resolves a bare agent name on PATH; the host's own installs must not answer it.
  vi.stubEnv('PATH', '')
  terminateWindowsProcessTreeMock.mockClear()
  terminateWindowsProcessTreeMock.mockResolvedValue(undefined)
  spawnMock.mockClear()
})

describe('generateCommitMessageFromContext on the Windows direct-child path', () => {
  it('caps local agent output before buffering unbounded data', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pending = generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'agent'
      },
      {
        kind: 'local',
        cwd: '/repo'
      }
    )

    listeners.get('stdout:data')?.(Buffer.alloc(4 * 1024 * 1024 + 1))
    listeners.get('close')?.(null)

    await expect(pending).resolves.toEqual({
      success: false,
      error:
        'agent CLI command produced too much output. Check the agent CLI configuration and try again.'
    })
    await expectChildTerminated(child)
  })

  it('passes prepared provider environment to local agent subprocesses', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const child = {
      pid: 123,
      kill: vi.fn(),
      stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
      stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
      stdin: { end: vi.fn() },
      on: vi.fn((event, callback) => listeners.set(event, callback))
    }
    spawnMock.mockReturnValue(child as never)

    const pending = generateCommitMessageFromContext(
      {
        branch: 'main',
        stagedSummary: 'M\tREADME.md',
        stagedPatch: '+hello'
      },
      {
        agentId: 'custom',
        model: '',
        customAgentCommand: 'orca-test-agent-nope'
      },
      {
        kind: 'local',
        cwd: '/repo',
        env: { ...process.env, CODEX_HOME: '/managed/codex-home' }
      }
    )

    listeners.get('stdout:data')?.(Buffer.from('Add README note\n'))
    listeners.get('close')?.(0)

    await expect(pending).resolves.toMatchObject({
      success: true,
      message: 'Add README note'
    })
    expect(spawnMock).toHaveBeenCalledWith(
      'orca-test-agent-nope',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ CODEX_HOME: '/managed/codex-home' })
      })
    )
  })

  it('routes WSL local commit generation through the selected distro login shell', async () => {
    await withPlatform('win32', async () => {
      process.env.ORCA_HOST_ONLY_SECRET = 'do-not-leak'
      const listeners = new Map<string, (value: unknown) => void>()
      const child = {
        pid: 123,
        kill: vi.fn(),
        stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
        stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
        stdin: { end: vi.fn() },
        on: vi.fn((event, callback) => listeners.set(event, callback))
      }
      spawnMock.mockReturnValue(child as never)

      const pending = generateCommitMessageFromContext(
        {
          branch: 'main',
          stagedSummary: 'M\tREADME.md',
          stagedPatch: '+hello'
        },
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'agent --mode fast'
        },
        {
          kind: 'local',
          cwd: 'C:\\repo',
          wslDistro: 'Ubuntu 24.04',
          env: { ...process.env, CODEX_HOME: '/home/tester/.codex' }
        }
      )

      listeners.get('stdout:data')?.(Buffer.from('Update README\n'))
      listeners.get('close')?.(0)

      await expect(pending).resolves.toMatchObject({
        success: true,
        message: 'Update README'
      })
      expect(spawnMock).toHaveBeenCalledWith(
        'wsl.exe',
        ['-d', 'Ubuntu 24.04', '--exec', 'sh', '-lc', expect.any(String)],
        expect.objectContaining({
          // Why a concrete directory (#16463): `undefined` makes CreateProcessW inherit
          // Orca's own cwd, a deletable WSL UNC path when it was launched from a
          // worktree. The Linux directory still rides inside the command (/mnt/c/repo,
          // asserted below), so the Windows-side cwd never decides where the agent runs.
          cwd: expect.any(String),
          windowsHide: true,
          env: expect.objectContaining({ CODEX_HOME: '/home/tester/.codex' })
        })
      )
      const spawnEnv = spawnMock.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv
      expect(spawnEnv.ORCA_HOST_ONLY_SECRET).toBeUndefined()
      const shellCommand = spawnMock.mock.calls[0]?.[1]?.[5] as string
      expect(shellCommand).toContain('getent passwd')
      expect(shellCommand).toContain('exec "$_orca_wsl_shell" -ilc')
      expect(shellCommand).toContain('/mnt/c/repo')
      expect(shellCommand).toContain("'agent'")
      expect(shellCommand).toContain('--mode')
      expect(shellCommand).toContain('fast')
    })
  })

  it('runs a batch-file agent through cmd.exe with quotes, percent signs and ampersands intact', async () => {
    vi.stubEnv('ComSpec', 'C:\\Windows\\System32\\cmd.exe')
    await withPlatform('win32', async () => {
      const listeners = new Map<string, (value: unknown) => void>()
      const child = {
        pid: 123,
        kill: vi.fn(),
        stdout: { on: vi.fn((event, callback) => listeners.set(`stdout:${event}`, callback)) },
        stderr: { on: vi.fn((event, callback) => listeners.set(`stderr:${event}`, callback)) },
        stdin: { end: vi.fn() },
        on: vi.fn((event, callback) => listeners.set(event, callback))
      }
      spawnMock.mockReturnValue(child as never)

      const pending = generateCommitMessageFromContext(
        {
          branch: 'main',
          stagedSummary: 'M\tREADME.md',
          stagedPatch: '+hello'
        },
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'C:/tools/agent.cmd --title "50% & more"'
        },
        {
          kind: 'local',
          cwd: 'C:\\repo'
        }
      )

      listeners.get('stdout:data')?.(Buffer.from('Update README\n'))
      listeners.get('close')?.(0)

      await expect(pending).resolves.toMatchObject({
        success: true,
        message: 'Update README'
      })
      // Nothing exists at the path, so process-host cannot resolve the shim and
      // encodes every argument for cmd.exe instead.
      expect(spawnMock).toHaveBeenCalledWith(
        'C:\\Windows\\System32\\cmd.exe',
        ['/d /v:off /s /c ""C:/tools/agent.cmd" "--title" "50"^%" & more""'],
        expect.objectContaining({
          cwd: 'C:\\repo',
          windowsHide: true,
          windowsVerbatimArguments: true
        })
      )
    })
  })

  it('explains that a batch file cmd.exe must run cannot take a multi-line argv prompt', async () => {
    await withPlatform('win32', async () => {
      const result = await generateCommitMessageFromContext(
        {
          branch: 'main',
          stagedSummary: 'M\tREADME.md',
          stagedPatch: '+hello & goodbye'
        },
        {
          agentId: 'custom',
          model: '',
          customAgentCommand: 'C:/tools/agent.cmd {prompt}'
        },
        {
          kind: 'local',
          cwd: 'C:\\repo'
        }
      )

      expect(result).toEqual({
        success: false,
        error:
          "C:/tools/agent.cmd runs through a Windows batch file (.cmd or .bat), which cannot pass a multi-line prompt as an argument. Set the agent command in Settings to the program's .exe, or, for a custom command, remove {prompt} so Orca sends the prompt on stdin."
      })
      expect(spawnMock).not.toHaveBeenCalled()
    })
  })
})
