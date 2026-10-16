import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockRunProcess } = vi.hoisted(() => ({ mockRunProcess: vi.fn() }))
vi.mock('@orca/process-host', () => ({ runProcess: mockRunProcess }))

import { shellToArgs, runShellCommandNode } from './workflow-node-runner-shell'

const BASE_DATA = { command: 'echo hi', workingDirectory: '/', timeoutSeconds: 5 }

beforeEach(() => {
  mockRunProcess.mockResolvedValue({ stdout: 'out', stderr: '', code: 0 })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('shellToArgs', () => {
  it('maps zsh to /bin/zsh with -c', () => {
    expect(shellToArgs('zsh', 'echo hi')).toEqual(['/bin/zsh', ['-c', 'echo hi']])
  })

  it('maps bash to /bin/bash with -c', () => {
    expect(shellToArgs('bash', 'echo hi')).toEqual(['/bin/bash', ['-c', 'echo hi']])
  })

  it('maps sh to /bin/sh with -c', () => {
    expect(shellToArgs('sh', 'echo hi')).toEqual(['/bin/sh', ['-c', 'echo hi']])
  })

  it('maps powershell to powershell.exe -Command', () => {
    expect(shellToArgs('powershell', 'Get-Date')).toEqual([
      'powershell.exe',
      ['-Command', 'Get-Date']
    ])
  })

  it('maps powershell.exe case-insensitively', () => {
    expect(shellToArgs('PowerShell.exe', 'Get-Date')).toEqual([
      'powershell.exe',
      ['-Command', 'Get-Date']
    ])
  })

  it('maps cmd to cmd.exe /c', () => {
    expect(shellToArgs('cmd', 'dir')).toEqual(['cmd.exe', ['/c', 'dir']])
  })

  it('uses an absolute path directly without prepending /bin/', () => {
    expect(shellToArgs('/usr/local/bin/fish', 'echo hi')).toEqual([
      '/usr/local/bin/fish',
      ['-c', 'echo hi']
    ])
  })
})

describe('runShellCommandNode — local exec', () => {
  it('calls runProcess with the correct program when shell is zsh', async () => {
    await runShellCommandNode({ ...BASE_DATA, shell: 'zsh' })
    const [expectedProgram, expectedArgs] = shellToArgs('zsh', BASE_DATA.command)
    expect(mockRunProcess).toHaveBeenCalledWith(
      expect.objectContaining({ program: expectedProgram, args: expectedArgs })
    )
  })

  it('uses platform default when shell is not set', async () => {
    await runShellCommandNode(BASE_DATA)
    // On the CI/test host (non-Windows), the default is /bin/sh
    const call = mockRunProcess.mock.calls[0][0]
    expect(typeof call.program).toBe('string')
    expect(call.args).toContain('-c')
  })

  it('forwards timeoutMs as timeoutSeconds * 1000', async () => {
    await runShellCommandNode({ ...BASE_DATA, timeoutSeconds: 10, shell: 'bash' })
    expect(mockRunProcess).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 10000 }))
  })

  it('maps runProcess result to stdout/stderr/exitCode', async () => {
    mockRunProcess.mockResolvedValueOnce({ stdout: 'hello', stderr: 'warn', code: 1 })
    const result = await runShellCommandNode({ ...BASE_DATA, shell: 'bash' })
    expect(result).toEqual({ stdout: 'hello', stderr: 'warn', exitCode: 1 })
  })
})

describe('runShellCommandNode — remote exec', () => {
  it('routes through remoteExec and skips shell selection', async () => {
    const remoteExec = vi.fn().mockResolvedValue({ stdout: 'remote', stderr: '', exitCode: 0 })
    const result = await runShellCommandNode({ ...BASE_DATA, shell: 'zsh' }, undefined, remoteExec)
    expect(remoteExec).toHaveBeenCalledWith('echo hi', expect.objectContaining({ timeoutMs: 5000 }))
    expect(mockRunProcess).not.toHaveBeenCalled()
    expect(result.stdout).toBe('remote')
  })
})
