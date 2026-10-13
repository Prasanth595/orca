import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { FILE_METHODS } from './files'

function fixture() {
  const runtime = {
    getRuntimeId: () => 'test',
    closeFileTabs: vi.fn(async () => ({ worktree: 'wt', closed: ['a.ts'] }))
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: files.close reads only the stubbed method and runtime ID.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: FILE_METHODS
  })
  return { runtime, dispatcher }
}

describe('files.close RPC', () => {
  it.each([{ relativePath: 'a.ts' }, { all: true, force: true }])(
    'forwards a valid target %j',
    async (target) => {
      const { runtime, dispatcher } = fixture()
      const params = { worktree: 'id:wt', ...target }
      expect(
        await dispatcher.dispatch({ id: 'close', authToken: 'tok', method: 'files.close', params })
      ).toMatchObject({ ok: true, result: { closed: ['a.ts'] } })
      expect(runtime.closeFileTabs).toHaveBeenCalledWith('id:wt', params)
    }
  )
  it.each([
    {},
    { relativePath: 'a.ts', all: true },
    { all: true, force: 'yes' },
    { relativePath: '' }
  ])('refuses invalid parameters %j', async (target) => {
    const { runtime, dispatcher } = fixture()
    expect(
      await dispatcher.dispatch({
        id: 'close',
        authToken: 'tok',
        method: 'files.close',
        params: { worktree: 'id:wt', ...target }
      })
    ).toMatchObject({ ok: false })
    expect(runtime.closeFileTabs).not.toHaveBeenCalled()
  })
})
