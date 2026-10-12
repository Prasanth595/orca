import { describe, expect, it, vi } from 'vitest'

import {
  attachWorkspaceStatusWarning,
  findUnknownWorkspaceStatusWarning
} from './worktree-workspace-status-check'

const CUSTOM_STATUSES = [
  { id: 'todo', label: 'Todo', color: 'neutral', icon: 'circle' },
  { id: 'needs-you', label: 'Needs you', color: 'amber', icon: 'flag' }
]

function clientReturning(ui: unknown) {
  return { call: vi.fn().mockResolvedValue({ id: 'r', ok: true, result: { ui } }) }
}

describe('findUnknownWorkspaceStatusWarning', () => {
  it('stays silent and skips the lookup when no status is being set', async () => {
    const client = clientReturning({})
    await expect(findUnknownWorkspaceStatusWarning(client, undefined)).resolves.toBeNull()
    expect(client.call).not.toHaveBeenCalled()
  })

  it('accepts a configured custom column id', async () => {
    const client = clientReturning({ workspaceStatuses: CUSTOM_STATUSES })
    await expect(findUnknownWorkspaceStatusWarning(client, 'needs-you')).resolves.toBeNull()
  })

  it('names the fallback column and the valid ids for an unknown id', async () => {
    const client = clientReturning({ workspaceStatuses: CUSTOM_STATUSES })
    const warning = await findUnknownWorkspaceStatusWarning(client, 'done')
    expect(warning).toContain('"done" is not a board column')
    expect(warning).toContain('under "Todo"')
    expect(warning).toContain('todo, needs-you')
  })

  it('checks against the defaults when the runtime has never customised them', async () => {
    const client = clientReturning({ workspaceStatuses: [] })
    const warning = await findUnknownWorkspaceStatusWarning(client, 'done')
    expect(warning).toContain('under "In progress"')
    expect(warning).toContain('completed')
    await expect(findUnknownWorkspaceStatusWarning(client, 'completed')).resolves.toBeNull()
  })

  it('stays silent when the runtime does not report its columns', async () => {
    await expect(findUnknownWorkspaceStatusWarning(clientReturning({}), 'done')).resolves.toBeNull()
    const failing = { call: vi.fn().mockRejectedValue(new Error('method_not_found')) }
    await expect(findUnknownWorkspaceStatusWarning(failing, 'done')).resolves.toBeNull()
  })
})

describe('attachWorkspaceStatusWarning', () => {
  it('adds the warning to the result and keeps the rest of the response', () => {
    const response = {
      id: 'r',
      ok: true as const,
      result: { worktree: { id: 'wt' } },
      _meta: { runtimeId: 'test-runtime' }
    }
    expect(attachWorkspaceStatusWarning(response, 'not a column')).toEqual({
      ...response,
      result: { worktree: { id: 'wt' }, warning: 'not a column' }
    })
  })
})
