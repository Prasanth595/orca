import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { COMMENT_METHODS } from './comment'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function createDispatcher() {
  const record = { id: 'c1', filePath: 'notes.md', source: 'markdown', line: 3, body: 'hi' }
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    listWorktreeComments: vi.fn().mockResolvedValue({ worktree: 'wt-1', comments: [record] }),
    removeWorktreeComment: vi.fn().mockResolvedValue({ worktree: 'wt-1', removed: record }),
    editWorktreeComment: vi
      .fn()
      .mockResolvedValue({ worktree: 'wt-1', comment: record, changed: true })
  }
  const dispatcher = new RpcDispatcher({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: COMMENT_METHODS handlers only call the stubbed members.
    runtime: runtime as unknown as OrcaRuntimeService,
    methods: COMMENT_METHODS
  })
  return { runtime, dispatcher }
}

describe('comment RPC methods', () => {
  it('lists with the selector, file and source the caller sent', async () => {
    const { runtime, dispatcher } = createDispatcher()

    const response = await dispatcher.dispatch(
      makeRequest('comment.list', {
        worktree: 'id:wt-1',
        filePath: 'notes.md',
        source: 'markdown'
      })
    )

    expect(response).toMatchObject({ ok: true, result: { worktree: 'wt-1' } })
    expect(runtime.listWorktreeComments).toHaveBeenCalledWith({
      selector: 'id:wt-1',
      filePath: 'notes.md',
      source: 'markdown'
    })
  })

  it('lists the whole worktree when no file or source is sent', async () => {
    const { runtime, dispatcher } = createDispatcher()

    await dispatcher.dispatch(makeRequest('comment.list', { worktree: 'id:wt-1' }))

    expect(runtime.listWorktreeComments).toHaveBeenCalledWith({ selector: 'id:wt-1' })
  })

  it('rejects an unknown source instead of listing everything', async () => {
    const { runtime, dispatcher } = createDispatcher()

    const response = await dispatcher.dispatch(
      makeRequest('comment.list', { worktree: 'id:wt-1', source: 'pdf' })
    )

    expect(response).toMatchObject({ ok: false })
    expect(runtime.listWorktreeComments).not.toHaveBeenCalled()
  })

  it('removes and edits by id', async () => {
    const { runtime, dispatcher } = createDispatcher()

    await dispatcher.dispatch(makeRequest('comment.rm', { worktree: 'id:wt-1', id: 'c1' }))
    await dispatcher.dispatch(
      makeRequest('comment.edit', { worktree: 'id:wt-1', id: 'c1', body: 'done' })
    )

    expect(runtime.removeWorktreeComment).toHaveBeenCalledWith({ selector: 'id:wt-1', id: 'c1' })
    expect(runtime.editWorktreeComment).toHaveBeenCalledWith({
      selector: 'id:wt-1',
      id: 'c1',
      body: 'done'
    })
  })

  it('rejects a missing id and a blank body before reaching the runtime', async () => {
    const { runtime, dispatcher } = createDispatcher()

    const noId = await dispatcher.dispatch(makeRequest('comment.rm', { worktree: 'id:wt-1' }))
    const blank = await dispatcher.dispatch(
      makeRequest('comment.edit', { worktree: 'id:wt-1', id: 'c1', body: '   ' })
    )

    expect(noId).toMatchObject({ ok: false })
    expect(blank).toMatchObject({ ok: false })
    expect(runtime.removeWorktreeComment).not.toHaveBeenCalled()
    expect(runtime.editWorktreeComment).not.toHaveBeenCalled()
  })

  it('reports an unknown comment as comment_not_found, not a generic runtime error', async () => {
    const { runtime, dispatcher } = createDispatcher()
    runtime.removeWorktreeComment.mockRejectedValue(new Error('comment_not_found'))

    const response = await dispatcher.dispatch(
      makeRequest('comment.rm', { worktree: 'id:wt-1', id: 'gone' })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'comment_not_found' } })
  })
})
