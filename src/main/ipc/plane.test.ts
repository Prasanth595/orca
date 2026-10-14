import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, operations } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args?: unknown) => unknown>(),
  operations: {
    connect: vi.fn(),
    status: vi.fn(),
    disconnect: vi.fn(),
    setProjectScope: vi.fn(),
    listProjects: vi.fn(),
    listWorkItems: vi.fn(),
    getWorkItem: vi.fn(),
    lookupWorkItem: vi.fn(),
    listStates: vi.fn(),
    listMembers: vi.fn(),
    listComments: vi.fn(),
    updateState: vi.fn(),
    addComment: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

vi.mock('../plane/plane-operations', () => ({ planeOperations: operations }))

import { registerPlaneHandlers } from './plane'

const PROJECT = '00000000-0000-4000-8000-000000000001'
const ITEM = '00000000-0000-4000-8000-000000000002'

function invoke(channel: string, args?: unknown): unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`no handler for ${channel}`)
  }
  return handler({}, args)
}

beforeEach(() => {
  handlers.clear()
  for (const fn of Object.values(operations)) {
    fn.mockReset()
  }
  registerPlaneHandlers()
})

describe('plane IPC handlers', () => {
  it('registers one channel per operation', () => {
    expect([...handlers.keys()].sort()).toEqual(
      Object.keys(operations)
        .map((name) => `plane:${name}`)
        .sort()
    )
  })

  it.each([
    ['plane:connect', { hostKind: 'self-hosted', workspaceSlug: 'acme', apiToken: 'plane_api_x' }],
    ['plane:connect', { hostKind: 'cloud', workspaceSlug: '../x', apiToken: 'plane_api_x' }],
    ['plane:getWorkItem', { projectId: 'WEB', workItemId: ITEM }],
    ['plane:listComments', undefined],
    ['plane:updateState', { projectId: PROJECT, workItemId: ITEM, stateId: '../../users/me' }],
    ['plane:addComment', { projectId: PROJECT, workItemId: ITEM, text: 'x'.repeat(10_001) }],
    ['plane:lookupWorkItem', { identifier: 'nope' }],
    ['plane:listStates', { projectId: 7 }],
    ['plane:listWorkItems', { cursorByProject: { [PROJECT]: 'next' } }],
    ['plane:setProjectScope', { scope: { mode: 'everything' } }]
  ])('rejects an invalid %s payload before any operation runs', (channel, args) => {
    expect(() => invoke(channel, args)).toThrow(/^Invalid plane:/)
    expect(Object.values(operations).every((fn) => fn.mock.calls.length === 0)).toBe(true)
  })

  it('never echoes the token in a validation error', () => {
    const token = 'plane_api_secret value'
    expect(() =>
      invoke('plane:connect', { hostKind: 'cloud', workspaceSlug: 'acme', apiToken: token })
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('secret') }))
  })

  it('passes normalized params to the shared operations', async () => {
    operations.updateState.mockResolvedValue({ ok: true, value: {} })
    await invoke('plane:updateState', {
      projectId: PROJECT.toUpperCase(),
      workItemId: ITEM,
      stateId: ITEM
    })
    expect(operations.updateState).toHaveBeenCalledWith({
      projectId: PROJECT,
      workItemId: ITEM,
      stateId: ITEM
    })
    await invoke('plane:connect', {
      hostKind: 'cloud',
      workspaceSlug: ' Acme ',
      apiToken: ' plane_api_x '
    })
    expect(operations.connect).toHaveBeenCalledWith({
      hostKind: 'cloud',
      workspaceSlug: 'acme',
      apiToken: 'plane_api_x'
    })
    await invoke('plane:listWorkItems')
    expect(operations.listWorkItems).toHaveBeenCalledWith(undefined)
  })
})
