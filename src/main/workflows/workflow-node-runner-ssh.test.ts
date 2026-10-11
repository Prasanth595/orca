/**
 * Tests for SSH remote execution paths of workflow node runners.
 * Each test supplies a mock RemoteExecFn and verifies the correct command
 * is forwarded to it — no real SSH connection is needed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockRunProcess } = vi.hoisted(() => ({ mockRunProcess: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mockRunProcess }))

import { runShellCommandNode } from './workflow-node-runner-shell'
import { runPythonScriptNode } from './workflow-node-runner-python'
import { runAgentCallNode } from './workflow-node-runner-agent'
import type { RemoteExecFn } from './workflow-remote-exec'

function makeRemoteExec(overrides?: {
  stdout?: string
  stderr?: string
  exitCode?: number
}): RemoteExecFn & ReturnType<typeof vi.fn> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: vi.fn() satisfies RemoteExecFn after mockResolvedValue sets the return shape; cast avoids a wrapper function just for types.
  return vi.fn().mockResolvedValue({
    stdout: overrides?.stdout ?? 'remote-out',
    stderr: overrides?.stderr ?? '',
    exitCode: overrides?.exitCode ?? 0
  }) as RemoteExecFn & ReturnType<typeof vi.fn>
}

function firstCallCmd(mock: ReturnType<typeof vi.fn>): string {
  return String(mock.mock.calls[0]?.[0] ?? '')
}

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Shell node ────────────────────────────────────────────────────────────────

describe('runShellCommandNode — SSH remote exec', () => {
  it('passes command string to remoteExec and returns its result', async () => {
    const remoteExec = makeRemoteExec({ stdout: 'hello' })
    const result = await runShellCommandNode(
      { command: 'echo hello', workingDirectory: '/', timeoutSeconds: 10, shell: 'bash' },
      undefined,
      remoteExec
    )
    expect(remoteExec).toHaveBeenCalledWith(
      'echo hello',
      expect.objectContaining({ timeoutMs: 10000 })
    )
    expect(mockRunProcess).not.toHaveBeenCalled()
    expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 })
  })

  it('forwards non-zero exit code from remote', async () => {
    const remoteExec = makeRemoteExec({ stdout: '', stderr: 'fail', exitCode: 2 })
    const result = await runShellCommandNode(
      { command: 'false', workingDirectory: '/', timeoutSeconds: 5 },
      undefined,
      remoteExec
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toBe('fail')
  })

  it('passes stdin and signal through to remoteExec', async () => {
    const remoteExec = makeRemoteExec()
    const signal = new AbortController().signal
    await runShellCommandNode(
      { command: 'cat', workingDirectory: '/', timeoutSeconds: 5 },
      'piped-input',
      remoteExec,
      signal
    )
    expect(remoteExec).toHaveBeenCalledWith(
      'cat',
      expect.objectContaining({ stdin: 'piped-input', signal })
    )
  })
})

// ─── Python node ───────────────────────────────────────────────────────────────

describe('runPythonScriptNode — SSH remote exec', () => {
  it('runs python3 - with script via stdin through remoteExec', async () => {
    const remoteExec = makeRemoteExec({ stdout: '42' })
    const result = await runPythonScriptNode(
      { script: 'print(42)', timeoutSeconds: 5, workingDirectory: '/' },
      undefined,
      remoteExec
    )
    expect(remoteExec).toHaveBeenCalledWith(
      'python3 -',
      expect.objectContaining({ stdin: 'print(42)', timeoutMs: 5000 })
    )
    expect(mockRunProcess).not.toHaveBeenCalled()
    expect(result.stdout).toBe('42')
  })

  it('uses pythonBin override when provided', async () => {
    const remoteExec = makeRemoteExec()
    await runPythonScriptNode(
      { script: 'pass', timeoutSeconds: 5, workingDirectory: '/', pythonBin: '/usr/bin/python' },
      undefined,
      remoteExec
    )
    expect(remoteExec).toHaveBeenCalledWith(
      expect.stringMatching(/^\/usr\/bin\/python\s/),
      expect.anything()
    )
  })

  it('passes the script verbatim via stdin so no shell escaping is needed', async () => {
    const remoteExec = makeRemoteExec()
    await runPythonScriptNode(
      { script: "print('hi')", timeoutSeconds: 5, workingDirectory: '/' },
      undefined,
      remoteExec
    )
    // Script with single-quotes arrives unescaped in stdin, not in the command string
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: remoteExec mock call args match (cmd: string, opts: object); destructured for readable assertions
    const [cmd, opts] = remoteExec.mock.calls[0] as [string, { stdin?: string }]
    expect(cmd).toBe('python3 -')
    expect(opts.stdin).toBe("print('hi')")
  })

  it('passes the script (not the original stdin) as stdin to remoteExec', async () => {
    // The script is piped via stdin; the caller's stdin arg is ignored for remote python runs
    // because python3 - already reads its script from stdin.
    const remoteExec = makeRemoteExec()
    await runPythonScriptNode(
      { script: 'import sys; print(sys.stdin.read())', timeoutSeconds: 5, workingDirectory: '/' },
      'my-stdin',
      remoteExec
    )
    expect(remoteExec).toHaveBeenCalledWith(
      'python3 -',
      expect.objectContaining({ stdin: 'import sys; print(sys.stdin.read())' })
    )
  })
})

// ─── Agent node ────────────────────────────────────────────────────────────────

const BASE_AGENT_DATA = {
  agentId: 'claude' as const,
  prompt: 'summarize this',
  structuredOutputSchema: null,
  model: undefined,
  workingDirectory: '/',
  timeoutSeconds: 30
}

describe('runAgentCallNode — SSH remote exec', () => {
  it('builds claude -p command and routes through remoteExec', async () => {
    const remoteExec = makeRemoteExec({ stdout: 'summary' })
    const result = await runAgentCallNode(BASE_AGENT_DATA, 'summarize this', remoteExec)
    expect(remoteExec).toHaveBeenCalledWith(
      expect.stringContaining('claude -p'),
      expect.objectContaining({ timeoutMs: 30000 })
    )
    expect(mockRunProcess).not.toHaveBeenCalled()
    expect(result.stdout).toBe('summary')
  })

  it('includes --model flag when model is specified', async () => {
    const remoteExec = makeRemoteExec()
    await runAgentCallNode(
      { ...BASE_AGENT_DATA, model: 'claude-opus-5-5' },
      'summarize this',
      remoteExec
    )
    const cmd = firstCallCmd(remoteExec)
    expect(cmd).toContain('--model claude-opus-5-5')
  })

  it('includes --output-format json when structuredOutputSchema is set', async () => {
    const remoteExec = makeRemoteExec({ stdout: '{"ok":true}' })
    await runAgentCallNode(
      { ...BASE_AGENT_DATA, structuredOutputSchema: '{"type":"object"}' },
      'summarize this',
      remoteExec
    )
    const cmd = firstCallCmd(remoteExec)
    expect(cmd).toContain('--output-format json')
  })

  it('escapes single-quotes in prompt to prevent shell injection', async () => {
    const remoteExec = makeRemoteExec()
    await runAgentCallNode(BASE_AGENT_DATA, "it's a test", remoteExec)
    const cmd = firstCallCmd(remoteExec)
    expect(cmd).toContain(`'\\''`)
  })

  it('builds codex command correctly', async () => {
    const remoteExec = makeRemoteExec()
    await runAgentCallNode({ ...BASE_AGENT_DATA, agentId: 'codex' }, 'write code', remoteExec)
    const cmd = firstCallCmd(remoteExec)
    expect(cmd).toMatch(/^codex\s/)
    expect(cmd).toContain('--quiet')
  })

  it('forwards signal to remoteExec', async () => {
    const remoteExec = makeRemoteExec()
    const signal = new AbortController().signal
    await runAgentCallNode(BASE_AGENT_DATA, 'go', remoteExec, signal)
    expect(remoteExec).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }))
  })
})
