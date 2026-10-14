// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANE_RUNTIME_CAPABILITY } from '../../../shared/plane-runtime-capabilities'
import type { PlaneConnectionStatus } from '../../../shared/plane-types'
import { createCompatibleRuntimeStatusResponse } from './runtime-compatibility-test-fixture'
import {
  PLANE_RUNTIME_UPDATE_REQUIRED_MESSAGE,
  isPlaneRuntimeUpdateRequiredError,
  planeConnectForTarget,
  planeDisconnectForTarget,
  planeListProjectsForTarget,
  planeSetProjectScopeForTarget,
  planeStatusForTarget
} from './runtime-plane-client'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'

const local = {
  status: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  setProjectScope: vi.fn(),
  listProjects: vi.fn()
}
const runtimeCall = vi.fn()
const REMOTE = { kind: 'environment', environmentId: 'env-1' } as const
const LOCAL = { kind: 'local' } as const
const DISCONNECTED: PlaneConnectionStatus = { connected: false }
const CONNECT_ARGS = {
  hostKind: 'cloud' as const,
  workspaceSlug: 'acme',
  apiToken: 'plane_api_secret'
}

function rpcResult(result: unknown) {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'remote-runtime' } }
}

function remoteHost(options: { plane: boolean; result?: unknown }): void {
  runtimeCall.mockImplementation(async (args: { method: string }) => {
    if (args.method !== 'status.get') {
      return rpcResult(options.result)
    }
    const status = createCompatibleRuntimeStatusResponse()
    if (!options.plane && status.ok) {
      status.result.capabilities = status.result.capabilities?.filter(
        (capability) => capability !== PLANE_RUNTIME_CAPABILITY
      )
    }
    return status
  })
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  for (const fn of Object.values(local)) {
    fn.mockReset()
  }
  runtimeCall.mockReset()
  vi.stubGlobal('window', {
    api: {
      plane: local,
      runtimeEnvironments: { call: runtimeCall, subscribe: vi.fn() }
    }
  })
})

describe('runtime Plane client', () => {
  it('routes the local target through the preload bridge only', async () => {
    local.status.mockResolvedValue(DISCONNECTED)
    local.connect.mockResolvedValue({ ok: false, error: 'auth', message: 'Invalid token' })
    local.setProjectScope.mockResolvedValue({ ok: true, value: DISCONNECTED })
    local.listProjects.mockResolvedValue({ ok: true, value: [] })
    local.disconnect.mockResolvedValue(DISCONNECTED)

    await expect(planeStatusForTarget(LOCAL)).resolves.toEqual(DISCONNECTED)
    await expect(planeConnectForTarget(LOCAL, CONNECT_ARGS)).resolves.toMatchObject({
      ok: false,
      error: 'auth'
    })
    await planeSetProjectScopeForTarget(LOCAL, { mode: 'all' })
    await planeListProjectsForTarget(LOCAL, { refresh: true })
    await planeDisconnectForTarget(LOCAL)

    expect(local.connect).toHaveBeenCalledWith(CONNECT_ARGS)
    expect(local.setProjectScope).toHaveBeenCalledWith({ scope: { mode: 'all' } })
    expect(local.listProjects).toHaveBeenCalledWith({ refresh: true })
    expect(runtimeCall).not.toHaveBeenCalled()
  })

  it('scopes disconnect, project scope and projects to one workspace connection', async () => {
    local.disconnect.mockResolvedValue(DISCONNECTED)
    local.setProjectScope.mockResolvedValue({ ok: true, value: DISCONNECTED })
    local.listProjects.mockResolvedValue({ ok: true, value: [] })

    await planeDisconnectForTarget(LOCAL, 'conn-2')
    await planeSetProjectScopeForTarget(LOCAL, { mode: 'all' }, 'conn-2')
    await planeListProjectsForTarget(LOCAL, { connectionId: 'conn-2' })

    expect(local.disconnect).toHaveBeenCalledWith({ connectionId: 'conn-2' })
    expect(local.setProjectScope).toHaveBeenCalledWith({
      scope: { mode: 'all' },
      connectionId: 'conn-2'
    })
    expect(local.listProjects).toHaveBeenCalledWith({ connectionId: 'conn-2' })

    remoteHost({ plane: true, result: DISCONNECTED })
    await planeDisconnectForTarget(REMOTE, 'conn-2')
    expect(runtimeCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'plane.disconnect', params: { connectionId: 'conn-2' } })
    )
  })

  it('adds a workspace with a saved token without sending one', async () => {
    remoteHost({ plane: true, result: { ok: false, error: 'not_connected', message: 'x' } })
    const reuse = { reuseTokenFromConnectionId: 'conn-1', workspaceSlug: 'beta' }

    await planeConnectForTarget(REMOTE, reuse)

    expect(runtimeCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'plane.connect', params: reuse })
    )
  })

  it('routes a remote target over runtime RPC after checking the Plane capability', async () => {
    remoteHost({ plane: true, result: { ok: true, value: [] } })

    await expect(planeListProjectsForTarget(REMOTE)).resolves.toEqual({ ok: true, value: [] })

    expect(runtimeCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ selector: 'env-1', method: 'plane.listProjects' })
    )
    expect(local.listProjects).not.toHaveBeenCalled()
  })

  it('sends connect credentials only to the selected remote host', async () => {
    remoteHost({ plane: true, result: { ok: false, error: 'auth', message: 'Invalid token' } })

    await planeConnectForTarget(REMOTE, CONNECT_ARGS)

    expect(runtimeCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'plane.connect', params: CONNECT_ARGS })
    )
    expect(local.connect).not.toHaveBeenCalled()
  })

  it.each([
    ['status', () => planeStatusForTarget(REMOTE)],
    ['connect', () => planeConnectForTarget(REMOTE, CONNECT_ARGS)],
    ['setProjectScope', () => planeSetProjectScopeForTarget(REMOTE, { mode: 'all' })],
    ['disconnect', () => planeDisconnectForTarget(REMOTE)]
  ])('asks an older host to update before %s', async (_name, call) => {
    remoteHost({ plane: false })

    const error: unknown = await call().then(
      () => null,
      (caught: unknown) => caught
    )

    expect(error).toEqual(new Error(PLANE_RUNTIME_UPDATE_REQUIRED_MESSAGE))
    expect(isPlaneRuntimeUpdateRequiredError(error)).toBe(true)
    expect(runtimeCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: expect.stringMatching(/^plane\./) })
    )
  })
})
