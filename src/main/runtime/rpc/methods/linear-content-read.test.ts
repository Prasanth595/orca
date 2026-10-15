import '../unused-default-rpc-methods.test-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RuntimeLinearCommands } from '../../runtime-linear-connection-commands'
import { installRuntimeLinearCommandSurface } from '../../runtime-linear-command-surface'
import { linearError } from '../../../linear/issue-context-errors'
import { LINEAR_AGENT_ACCESS_METHODS } from './linear-agent-access'

const mocks = vi.hoisted(() => ({ project: vi.fn(), document: vi.fn() }))
vi.mock('../../../linear/linear-content-read', () => ({
  readLinearProjectContent: mocks.project,
  readLinearDocumentContent: mocks.document
}))

// The real forwarding surface, with ports that refuse unrelated runtime operations.
class ReadOnlyRuntime {
  readonly linearCommands = new RuntimeLinearCommands({
    runtimeAvailable: () => false,
    showTerminal: async () => {
      throw new Error('unexpected terminal access')
    },
    resolveWorktreeSelector: async () => {
      throw new Error('unexpected worktree access')
    },
    listResolvedWorktrees: async () => [],
    setWorktreeMeta: () => {
      throw new Error('unexpected metadata write')
    },
    emitClientEvent: () => {
      throw new Error('unexpected runtime event')
    }
  })
  getRuntimeId(): string {
    return 'isolated-content-read'
  }
}
installRuntimeLinearCommandSurface(ReadOnlyRuntime.prototype)
const id = '22222222-2222-4222-8222-222222222222'
const workspaceId = '11111111-1111-4111-8111-111111111111'
function dispatcher() {
  const facade = new ReadOnlyRuntime()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: These explicit read methods use only the installed Linear surface and getRuntimeId; all unrelated ports reject.
  const runtime = facade as unknown as OrcaRuntimeService
  return new RpcDispatcher({ runtime, methods: LINEAR_AGENT_ACCESS_METHODS })
}
beforeEach(() => {
  vi.resetAllMocks()
})

describe('Content RPC params and installed runtime surface', () => {
  it('defaults project full off and delegates through the installed facade', async () => {
    mocks.project.mockResolvedValue({ project: { id }, documents: [], meta: { partial: false } })
    const response = await dispatcher().dispatch({
      id: 'req',
      authToken: 'fixture',
      method: 'linear.agentProjectRead',
      params: { id, workspaceId }
    })
    expect(response.ok).toBe(true)
    expect(mocks.project).toHaveBeenCalledWith({ id, workspaceId, full: false })
  })
  it('passes full and document slugs unchanged', async () => {
    mocks.project.mockResolvedValue({ project: { id }, documents: [] })
    mocks.document.mockResolvedValue({ document: { id, content: 'Full body' } })
    const rpc = dispatcher()
    expect(
      (
        await rpc.dispatch({
          id: 'project',
          authToken: 'fixture',
          method: 'linear.agentProjectRead',
          params: { id, workspaceId, full: true }
        })
      ).ok
    ).toBe(true)
    expect(
      (
        await rpc.dispatch({
          id: 'document',
          authToken: 'fixture',
          method: 'linear.agentDocumentRead',
          params: { id: 'design-slug', workspaceId }
        })
      ).ok
    ).toBe(true)
    expect(mocks.project).toHaveBeenCalledWith({ id, workspaceId, full: true })
    expect(mocks.document).toHaveBeenCalledWith({ id: 'design-slug', workspaceId })
  })
  it.each([
    { id, workspaceId: 'all' },
    { id },
    { id: 'project-name', workspaceId },
    { id, workspaceId, full: 'yes' }
  ])('rejects invalid project params before the SDK boundary: %j', async (params) => {
    const response = await dispatcher().dispatch({
      id: 'req',
      authToken: 'fixture',
      method: 'linear.agentProjectRead',
      params
    })
    expect(response.ok).toBe(false)
    expect(mocks.project).not.toHaveBeenCalled()
  })
  it('requires document identity and a concrete workspace', async () => {
    const rpc = dispatcher()
    for (const params of [
      { id: '', workspaceId },
      { id: 'slug' },
      { id: 'slug', workspaceId: 'all' }
    ]) {
      expect(
        (
          await rpc.dispatch({
            id: 'req',
            authToken: 'fixture',
            method: 'linear.agentDocumentRead',
            params
          })
        ).ok
      ).toBe(false)
    }
    expect(mocks.document).not.toHaveBeenCalled()
  })
  it('preserves rate-limit timing in the public RPC error envelope', async () => {
    const data = { retryAfterSeconds: 120, requestsResetAtMs: 1792022520000 }
    mocks.document.mockRejectedValue(linearError('linear_rate_limited', 'Too many requests', data))
    const response = await dispatcher().dispatch({
      id: 'limited',
      authToken: 'fixture',
      method: 'linear.agentDocumentRead',
      params: { id, workspaceId }
    })
    expect(response).toEqual({
      id: 'limited',
      ok: false,
      error: { code: 'linear_rate_limited', message: 'Too many requests', data },
      _meta: { runtimeId: 'isolated-content-read' }
    })
  })
  it('keeps read methods on the existing workspace permission boundary', () => {
    const reads = LINEAR_AGENT_ACCESS_METHODS.filter((method) =>
      ['linear.agentProjectRead', 'linear.agentDocumentRead'].includes(method.name)
    )
    expect(reads).toHaveLength(2)
    expect(reads.map((method) => method.permission)).toEqual(['workspace', 'workspace'])
  })
})
