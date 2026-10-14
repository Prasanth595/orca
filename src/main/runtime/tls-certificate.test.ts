import type * as ChildProcess from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProcessHost from '@orca/process-host'
import { loadOrCreateTlsCertificate } from './tls-certificate'

const { runProcessSyncMock, directExecFileSyncMock } = vi.hoisted(() => ({
  runProcessSyncMock: vi.fn<typeof ProcessHost.runProcessSync>(),
  directExecFileSyncMock: vi.fn()
}))

vi.mock('@orca/process-host', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessHost>()),
  runProcessSync: runProcessSyncMock
}))

// Why: a direct launch would skip process-host's hidden Windows console.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: directExecFileSyncMock
}))

const PEM = '-----BEGIN CERTIFICATE-----\nAAEC\n-----END CERTIFICATE-----\n'

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'orca-tls-certificate-'))
  runProcessSyncMock.mockReset()
  directExecFileSyncMock.mockReset()
})

afterEach(() => {
  rmSync(userDataPath, { recursive: true, force: true })
})

function argAfter(args: readonly string[] | undefined, flag: string): string {
  const value = args?.[args.indexOf(flag) + 1]
  if (value === undefined) {
    throw new Error(`missing ${flag}`)
  }
  return value
}

describe('loadOrCreateTlsCertificate', () => {
  it('generates the certificate with openssl through process-host', () => {
    runProcessSyncMock.mockImplementation((spec) => {
      writeFileSync(argAfter(spec.args, '-keyout'), 'key')
      writeFileSync(argAfter(spec.args, '-out'), PEM)
      return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
    })

    const tls = loadOrCreateTlsCertificate(userDataPath)

    expect(runProcessSyncMock).toHaveBeenCalledTimes(1)
    expect(runProcessSyncMock.mock.calls[0][0]).toMatchObject({
      program: process.platform === 'win32' ? expect.any(String) : 'openssl',
      stdio: 'ignore'
    })
    expect(directExecFileSyncMock).not.toHaveBeenCalled()
    expect(tls).toEqual({ cert: PEM, key: 'key', fingerprint: expect.stringMatching(/^sha256:/) })
  })

  it.each([
    ['exits non-zero', { code: 1, signal: null, timedOut: false }],
    ['times out', { code: null, signal: 'SIGTERM' as const, timedOut: true }]
  ])('reports an openssl run that %s as the failure', (_, outcome) => {
    runProcessSyncMock.mockReturnValue({ stdout: '', stderr: '', ...outcome })

    expect(() => loadOrCreateTlsCertificate(userDataPath)).toThrow(/^openssl exited with/)
  })
})
