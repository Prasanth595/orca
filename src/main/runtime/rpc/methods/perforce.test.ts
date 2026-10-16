import '../unused-default-rpc-methods.test-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { PERFORCE_OPERATION_NAMES } from '../../../../shared/perforce/perforce-operations'
import { currentPerforceSettings } from '../../../../shared/perforce/p4-settings-context'

const { backend, settingsSeen } = vi.hoisted(() => {
  const settingsSeen: unknown[] = []
  const names = [
    'detect',
    'info',
    'status',
    'history',
    'diff',
    'diffText',
    'isReadOnlyFile',
    'checkoutIfReadOnly',
    'open',
    'edit',
    'close',
    'discard',
    'submit',
    'sync',
    'shelve',
    'unshelve',
    'unshelveFrom',
    'shelveAndRevertFiles',
    'unshelveFiles',
    'deleteChangelistWithFiles',
    'deleteShelf',
    'createChangelist',
    'editDescription',
    'moveToChangelist',
    'deleteChangelist'
  ]
  return {
    settingsSeen,
    backend: Object.fromEntries(names.map((name) => [name, vi.fn()]))
  }
})

vi.mock('../../../../shared/perforce/perforce-backend', () => ({ localPerforceBackend: backend }))

const { PERFORCE_METHODS } = await import('./perforce')

function dispatcher(executionHostId = 'local'): RpcDispatcher {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the methods only call resolveRuntimeFileTarget and getRuntimeId.
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    resolveRuntimeFileTarget: vi.fn(async (selector: string) => {
      if (selector !== 'id:repo::/srv/ws') {
        throw new Error('unknown worktree')
      }
      return { worktree: { path: '/srv/ws' }, executionHostId }
    })
  } as unknown as OrcaRuntimeService
  return new RpcDispatcher({ runtime, methods: PERFORCE_METHODS })
}

async function call(method: string, params: Record<string, unknown>, executionHostId?: string) {
  return dispatcher(executionHostId).dispatch({
    id: 'r1',
    authToken: 'token',
    method,
    params: { worktree: 'id:repo::/srv/ws', ...params }
  })
}

beforeEach(() => {
  settingsSeen.length = 0
  for (const fn of Object.values(backend)) {
    fn.mockReset()
    fn.mockImplementation(async () => {
      settingsSeen.push(currentPerforceSettings())
      return { success: true }
    })
  }
})

describe('perforce.* RPC methods', () => {
  it('registers one method per Perforce operation shared with the desktop IPC', () => {
    expect(PERFORCE_METHODS.map((m) => m.name).sort()).toEqual(
      PERFORCE_OPERATION_NAMES.map((name) => `perforce.${name}`).sort()
    )
    expect(PERFORCE_METHODS.every((m) => m.permission === 'workspace')).toBe(true)
  })

  it('runs the operation in the resolved workspace and returns its result', async () => {
    backend.status.mockResolvedValue({ entries: [], changelists: [] })
    const response = await call('perforce.status', {})
    expect(response).toMatchObject({ ok: true, result: { entries: [], changelists: [] } })
    expect(backend.status).toHaveBeenCalledWith('/srv/ws')
  })

  it('applies the caller p4 settings for the duration of the call', async () => {
    await call('perforce.info', {
      settings: { p4Path: '/opt/p4/bin/p4', p4Port: 'ssl:perforce:1666', p4User: 'ray' }
    })
    expect(settingsSeen[0]).toMatchObject({
      p4Path: '/opt/p4/bin/p4',
      p4Port: 'ssl:perforce:1666',
      p4User: 'ray'
    })
    expect(currentPerforceSettings().p4Path).toBe('')
  })

  it('passes validated arguments for file and changelist operations', async () => {
    await call('perforce.open', { filePaths: ['src/a.ts', 'docs/b.md'] })
    expect(backend.open).toHaveBeenCalledWith('/srv/ws', ['src/a.ts', 'docs/b.md'])
    await call('perforce.moveToChangelist', { filePaths: ['src/a.ts'], changelist: 7 })
    expect(backend.moveToChangelist).toHaveBeenCalledWith('/srv/ws', ['src/a.ts'], 7)
    await call('perforce.unshelveFrom', { sourceChangelist: 3, changelist: 'default' })
    expect(backend.unshelveFrom).toHaveBeenCalledWith('/srv/ws', 3, 'default')
    await call('perforce.history', { limit: 5000 })
    expect(backend.history).toHaveBeenCalledWith('/srv/ws', 200)
  })

  it('rejects paths that escape the workspace before p4 runs', async () => {
    const response = await call('perforce.edit', { filePaths: ['../etc/passwd'] })
    expect(response.ok).toBe(false)
    expect(backend.edit).not.toHaveBeenCalled()
  })

  it('requires a description when submitting the default changelist', async () => {
    const missing = await call('perforce.submit', { changelist: 'default' })
    expect(missing.ok).toBe(false)
    expect(backend.submit).not.toHaveBeenCalled()
    await call('perforce.submit', { changelist: 'default', message: 'Fix build' })
    expect(backend.submit).toHaveBeenCalledWith('/srv/ws', 'default', 'Fix build')
    await call('perforce.submit', { changelist: 12 })
    expect(backend.submit).toHaveBeenLastCalledWith('/srv/ws', 12, undefined)
  })

  it('rejects malformed params at the schema boundary', async () => {
    const response = await call('perforce.shelve', { changelist: -1 })
    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(backend.shelve).not.toHaveBeenCalled()
  })

  it('refuses a workspace another host owns instead of running p4 here', async () => {
    const response = await call('perforce.status', {}, 'ssh:other-target')
    expect(response.ok).toBe(false)
    expect(backend.status).not.toHaveBeenCalled()
  })
})
