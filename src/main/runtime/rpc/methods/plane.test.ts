import '../unused-default-rpc-methods.test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createPlaneApiFixture,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_TOKEN,
  planeConnectParams,
  fixtureUuid,
  type PlaneApiFixture
} from '../../../plane/__mocks__/plane-api-fixture'
import { loadPlaneMainModule } from '../../../plane/__mocks__/plane-http-module'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RuntimePlaneCommands } from '../../runtime-plane-commands'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { PLANE_METHODS } from './plane'

function request(method: string, params?: unknown): RpcRequest {
  return { id: `req-${method}`, authToken: 'tok', method, params }
}

type PlaneRuntimeFake = Partial<Record<keyof RuntimePlaneCommands, unknown>>

function dispatcherFor(runtime: PlaneRuntimeFake): RpcDispatcher {
  // Why a prototype link: a RuntimePlaneCommands instance keeps its methods on its prototype.
  const fake = Object.assign(Object.create(runtime), { getRuntimeId: () => 'test-runtime' })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: PLANE_METHODS only reach the plane* methods this fake provides.
  const service = fake as OrcaRuntimeService
  return new RpcDispatcher({ runtime: service, methods: PLANE_METHODS })
}

const StreamReply = z.object({
  result: z.object({ type: z.string(), content: z.string().optional() })
})

describe('plane RPC method declarations', () => {
  it('needs accounts-admin to change the credential and workspace for everything else', () => {
    const permissions = Object.fromEntries(PLANE_METHODS.map((m) => [m.name, m.permission]))
    expect(permissions).toEqual({
      'plane.connect': 'accounts-admin',
      'plane.disconnect': 'accounts-admin',
      'plane.setProjectScope': 'accounts-admin',
      'plane.status': 'workspace',
      'plane.listProjects': 'workspace',
      'plane.listWorkItems': 'workspace',
      'plane.getWorkItem': 'workspace',
      'plane.lookupWorkItem': 'workspace',
      'plane.listStates': 'workspace',
      'plane.listMembers': 'workspace',
      'plane.listComments': 'workspace',
      'plane.updateState': 'workspace',
      'plane.addComment': 'workspace'
    })
  })

  it('is not offered to mobile clients', async () => {
    const response = await dispatcherFor({ planeStatus: vi.fn() }).dispatch(
      request('plane.status'),
      {
        callerScope: { kind: 'mobile' }
      }
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})

describe('plane RPC validation', () => {
  it.each([
    ['plane.getWorkItem', { projectId: '../../users/me', workItemId: fixtureUuid(1) }],
    ['plane.updateState', { projectId: fixtureUuid(1), workItemId: fixtureUuid(2), stateId: 'x' }],
    ['plane.addComment', { projectId: fixtureUuid(1), workItemId: fixtureUuid(2), text: ' ' }],
    ['plane.lookupWorkItem', { identifier: 'WEB-12/../x' }],
    ['plane.setProjectScope', { scope: { mode: 'selected', projectIds: [] } }],
    ['plane.connect', { hostKind: 'self-hosted', workspaceSlug: 'acme', apiToken: 'plane_api_x' }]
  ])('rejects bad %s params before the runtime runs', async (method, params) => {
    const runtime = Object.fromEntries(
      PLANE_METHODS.map((m) => [
        `plane${m.name.slice(6, 7).toUpperCase()}${m.name.slice(7)}`,
        vi.fn()
      ])
    )
    const response = await dispatcherFor(runtime).dispatch(request(method, params))
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(Object.values(runtime).every((fn) => vi.mocked(fn).mock.calls.length === 0)).toBe(true)
  })

  it('keeps a rejected token out of the error', async () => {
    const response = await dispatcherFor({ planeConnect: vi.fn() }).dispatch(
      request('plane.connect', {
        hostKind: 'cloud',
        workspaceSlug: 'acme',
        apiToken: 'plane_api_a b'
      })
    )
    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).not.toContain('plane_api_a')
  })
})

describe('plane.listWorkItems streaming', () => {
  it('splits a large list into chunks the client reassembles', async () => {
    const list = { ok: true, value: { items: [{ name: 'x'.repeat(300_000) }], errors: [] } }
    const dispatcher = dispatcherFor({ planeListWorkItems: vi.fn().mockResolvedValue(list) })
    const replies: string[] = []
    await dispatcher.dispatchStreaming(request('plane.listWorkItems', {}), (r) => replies.push(r))
    const messages = replies.map((reply) => StreamReply.parse(JSON.parse(reply)).result)
    expect(messages.at(-1)).toEqual({ type: 'end' })
    expect(messages.filter((m) => m.type === 'chunk')).toHaveLength(2)
    expect(JSON.parse(messages.map((m) => m.content ?? '').join(''))).toEqual(list)
  })
})

describe.each(PLANE_FIXTURE_BASES)('plane RPC end to end on $name', (base) => {
  let tempHome = ''
  let fixture: PlaneApiFixture
  let dispatcher: RpcDispatcher

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-rpc-'))
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    const { RuntimePlaneCommands } = await import('../../runtime-plane-commands')
    dispatcher = dispatcherFor(new RuntimePlaneCommands())
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  const call = (method: string, params?: unknown): Promise<RpcResponse> =>
    dispatcher.dispatch(request(method, params))

  it('connects, reports status and lists without ever returning the token', async () => {
    const responses = [
      await call('plane.connect', planeConnectParams(base)),
      await call('plane.status'),
      await call('plane.setProjectScope', { scope: { mode: 'all' } }),
      await call('plane.listProjects', { refresh: true })
    ]
    expect(responses.every((r) => r.ok)).toBe(true)
    expect(responses[0]).toMatchObject({ result: { ok: true, status: { connected: true } } })
    for (const response of responses) {
      expect(JSON.stringify(response)).not.toContain(PLANE_FIXTURE_TOKEN)
    }
  })

  it('answers a rejected token and a missing connection as typed results', async () => {
    fixture.failures.set('/users/me/', 401)
    const connect = await call('plane.connect', planeConnectParams(base))
    expect(connect).toMatchObject({ ok: true, result: { ok: false, error: 'auth' } })
    expect(JSON.stringify(connect)).not.toContain(PLANE_FIXTURE_TOKEN)
    await expect(call('plane.listProjects', {})).resolves.toMatchObject({
      ok: true,
      result: { ok: false, error: { kind: 'not_connected' } }
    })
  })
})
