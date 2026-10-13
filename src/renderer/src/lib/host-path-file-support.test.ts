import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../shared/protocol-version'
import { FILES_HOST_PATH_RUNTIME_CAPABILITY } from '../../../shared/runtime-file-contracts'
import { markRuntimeEnvironmentCompatible } from '@/runtime/runtime-rpc-client'
import { createCompatibleRuntimeStatusResponse } from '@/runtime/runtime-compatibility-test-fixture'
import { knownRuntimeEnvironmentServesFilesByPath } from '@/runtime/runtime-file-address'
import {
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentTransportCall,
  type RuntimeRpcRequest
} from '@/runtime/runtime-file-client-test-harness'
import { hostServesFilesByPathForUserAction } from './host-path-file-support'

const store = vi.hoisted(() => ({
  runtimeStatusByEnvironmentId: new Map<string, { status: unknown }>()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))

installRuntimeFileClientEnvironment()

const capableStatus = {
  runtimeId: 'remote-runtime',
  runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
  minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  capabilities: [FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY, FILES_HOST_PATH_RUNTIME_CAPABILITY]
}

function hostAnswers(): void {
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeRpcRequest) =>
    Promise.resolve(
      args.method === 'status.get'
        ? { id: 'status', ok: true, result: capableStatus, _meta: { runtimeId: 'remote-runtime' } }
        : { id: 'rpc', ok: false, error: { code: 'method_not_found', message: 'nope' } }
    )
  )
}

function statusCalls(): number {
  return runtimeEnvironmentTransportCall.mock.calls.filter(([args]) => args.method === 'status.get')
    .length
}

describe('whether a host serves files by path, for something the user just did', () => {
  beforeEach(() => {
    store.runtimeStatusByEnvironmentId = new Map()
  })

  it('asks a host with no cached status once, and answers from it', async () => {
    hostAnswers()

    expect(await hostServesFilesByPathForUserAction('env-1')).toBe(true)
    expect(await hostServesFilesByPathForUserAction('env-1')).toBe(true)
    expect(statusCalls()).toBe(1)
  })

  it('answers at once for a host the app shows as unreachable', async () => {
    hostAnswers()
    store.runtimeStatusByEnvironmentId.set('env-1', { status: null })

    expect(await hostServesFilesByPathForUserAction('env-1')).toBe(false)
    // The never-wait check asks in the background; the user action did not wait on it.
    expect(statusCalls()).toBeLessThanOrEqual(1)
  })

  it('asks again on Retry after a failed probe', async () => {
    runtimeEnvironmentTransportCall.mockRejectedValue(new Error('socket closed'))
    expect(await hostServesFilesByPathForUserAction('env-1')).toBe(false)

    hostAnswers()

    expect(await hostServesFilesByPathForUserAction('env-1')).toBe(true)
  })

  it('reads the status a reachability check already proved, without asking again', async () => {
    hostAnswers()
    const proved = createCompatibleRuntimeStatusResponse()
    if (!proved.ok) {
      throw new Error('fixture status must be a success')
    }
    markRuntimeEnvironmentCompatible('env-1', proved.result)

    expect(knownRuntimeEnvironmentServesFilesByPath('env-1')).toBe(true)
    expect(statusCalls()).toBe(0)
  })
})
