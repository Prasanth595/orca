import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { okFixture, queueFixtures } from './test-fixtures'
import { AUTOMATION_RUN_REPORT_RUNTIME_CAPABILITY } from '../shared/automation-runtime-capabilities'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('orca cli automation run reporting', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })
  const args = [
    'automations',
    'report',
    '--run-id',
    'run-1',
    '--run-token',
    'token-1',
    '--status',
    'needs-attention',
    '--message',
    'Review policy changes',
    '--json'
  ]

  it('reports through the selected execution host after checking capability', async () => {
    queueFixtures(
      callMock,
      okFixture('status', { capabilities: [AUTOMATION_RUN_REPORT_RUNTIME_CAPABILITY] }),
      okFixture('report', { run: { id: 'run-1', result: { status: 'needs_attention' } } })
    )
    vi.stubEnv('ORCA_SSH_BRIDGE_CREDENTIAL', 'scoped-ssh-credential')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(args, '/tmp/repo')
    expect(callMock).toHaveBeenNthCalledWith(1, 'status.get')
    expect(callMock).toHaveBeenNthCalledWith(2, 'automation.reportRun', {
      runId: 'run-1',
      token: 'token-1',
      status: 'needs_attention',
      message: 'Review policy changes'
    })
  })

  it('refuses older hosts without sending a report they cannot persist', async () => {
    queueFixtures(callMock, okFixture('status', { capabilities: [] }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitCode = process.exitCode
    try {
      await main(args, '/tmp/repo')
      expect(callMock).toHaveBeenCalledTimes(1)
      expect([...log.mock.calls, ...error.mock.calls].flat().join('\n')).toContain(
        'Update the execution host'
      )
    } finally {
      process.exitCode = exitCode
    }
  })

  it('rejects success reports before contacting the host', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitCode = process.exitCode
    try {
      await main(
        args.map((arg) => (arg === 'needs-attention' ? 'success' : arg)),
        '/tmp/repo'
      )
      expect(callMock).not.toHaveBeenCalled()
      expect([...log.mock.calls, ...error.mock.calls].flat().join('\n')).toContain(
        'failed or --status needs-attention'
      )
    } finally {
      process.exitCode = exitCode
    }
  })
})
