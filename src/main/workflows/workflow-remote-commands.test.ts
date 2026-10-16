import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { buildRemotePythonCommand, buildRemoteShellCommand } from './workflow-remote-commands'

const canRun = process.platform !== 'win32'
let home = ''

/** Runs a built command the way an SSH host's login shell would. */
async function onHost(command: string, stdin?: string) {
  const result = await runProcess({
    program: '/bin/sh',
    args: ['-c', command],
    cwd: home,
    input: stdin,
    timeoutMs: 10_000
  })
  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'orca-remote-cmd-')))
  mkdirSync(join(home, 'work dir'))
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

const shellNode = { workingDirectory: '', timeoutSeconds: 5 }

describe.skipIf(!canRun)('buildRemoteShellCommand', () => {
  it('runs in the node working directory, even with spaces', async () => {
    const out = await onHost(
      buildRemoteShellCommand({
        ...shellNode,
        command: 'pwd',
        workingDirectory: join(home, 'work dir')
      })
    )
    expect(out.stdout.trim()).toBe(join(home, 'work dir'))
  })

  it('stops every statement when the working directory is missing', async () => {
    const out = await onHost(
      buildRemoteShellCommand({
        ...shellNode,
        command: 'echo first; echo second',
        workingDirectory: join(home, 'missing')
      })
    )
    expect(out.code).not.toBe(0)
    expect(out.stdout).toBe('')
  })

  it('uses the chosen shell and the node environment', async () => {
    const out = await onHost(
      buildRemoteShellCommand({
        ...shellNode,
        command: 'echo "$GREETING from $0"',
        shell: 'sh',
        env: { GREETING: "it's me", 'BAD-NAME': 'dropped' }
      })
    )
    expect(out.stdout.trim()).toBe("it's me from sh")
  })

  it('ignores a Windows shell copied into an SSH workflow', async () => {
    expect(buildRemoteShellCommand({ ...shellNode, command: 'echo hi', shell: 'powershell' })).toBe(
      '{ echo hi\n}'
    )
  })

  it('passes the upstream output on stdin', async () => {
    const out = await onHost(
      buildRemoteShellCommand({ ...shellNode, command: 'tr a-z A-Z' }),
      'abc'
    )
    expect(out.stdout).toBe('ABC')
  })
})

describe.skipIf(!canRun || !existsSync('/usr/bin/python3'))('buildRemotePythonCommand', () => {
  it('runs the script with the upstream output on stdin, in its working directory', async () => {
    const script = [
      'import json, os, sys',
      "print(json.dumps({'stdin': sys.stdin.read(), 'cwd': os.getcwd(), 'quote': \"it's\"}))"
    ].join('\n')
    const out = await onHost(
      buildRemotePythonCommand({
        script,
        workingDirectory: join(home, 'work dir'),
        timeoutSeconds: 5
      }),
      'upstream output'
    )
    expect(out.code, out.stderr).toBe(0)
    expect(JSON.parse(out.stdout)).toEqual({
      stdin: 'upstream output',
      cwd: join(home, 'work dir'),
      quote: "it's"
    })
  })
})
