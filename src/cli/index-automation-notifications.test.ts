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
import { AUTOMATION_NOTIFICATION_POLICY_RUNTIME_CAPABILITY } from '../shared/automation-runtime-capabilities'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('orca cli per-automation notifications', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it.each([true, false])('saves %s only after checking host support', async (notifyOnFailure) => {
    queueFixtures(
      callMock,
      okFixture('status', { capabilities: [AUTOMATION_NOTIFICATION_POLICY_RUNTIME_CAPABILITY] }),
      okFixture('owner', { automation: { id: 'a1', name: 'Review' } }),
      okFixture('update', { automation: { id: 'a1', name: 'Review' } })
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await main(
      ['automations', 'edit', 'a1', '--notify-on-failure', String(notifyOnFailure), '--json'],
      '/tmp/repo'
    )
    expect(callMock).toHaveBeenNthCalledWith(1, 'status.get')
    expect(callMock).toHaveBeenNthCalledWith(3, 'automation.update', {
      id: 'a1',
      updates: expect.objectContaining({ notifyOnFailure })
    })
  })

  it('refuses disabling on an older host instead of silently dropping false', async () => {
    queueFixtures(callMock, okFixture('status', { capabilities: [] }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const priorExitCode = process.exitCode
    try {
      await main(
        ['automations', 'edit', 'a1', '--notify-on-failure', 'false', '--json'],
        '/tmp/repo'
      )
      expect(callMock).toHaveBeenCalledTimes(1)
      expect([...log.mock.calls, ...error.mock.calls].flat().join('\n')).toContain(
        'Configuring automation alerts requires a newer Orca server'
      )
    } finally {
      process.exitCode = priorExitCode
    }
  })

  it('rejects invalid values before writing', async () => {
    const priorExitCode = process.exitCode
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await main(
        ['automations', 'edit', 'a1', '--notify-on-failure', 'maybe', '--json'],
        '/tmp/repo'
      )
      expect(callMock).not.toHaveBeenCalled()
    } finally {
      process.exitCode = priorExitCode
    }
  })
})
