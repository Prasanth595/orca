import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
      environmentSelector?: string | null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { main } from '../index'
import { RuntimeClientError } from '../runtime-client'
import { buildWorktree, okFixture, queueFixtures, worktreeListFixture } from '../test-fixtures'

const COMMENT = {
  id: '3f9c1a52-7e0b-4d6a-9a41-0c2f8e5b6d17',
  filePath: 'notes/status.md',
  source: 'markdown',
  line: 12,
  selectedText: 'Blocked on legal',
  body: 'Is this still blocked?\nNeed an answer today.',
  createdAt: 1_760_000_000_000
}

describe('orca comment CLI handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('prints group help with the comment commands', async () => {
    await main(['comment', '--help'], '/tmp/repo')

    const output = vi.mocked(console.log).mock.calls[0][0]
    expect(output).toContain('list')
    expect(output).toContain('rm')
    expect(output).toContain('edit')
  })

  it('lists one file in the worktree inferred from cwd and prints a readable summary', async () => {
    queueFixtures(
      callMock,
      worktreeListFixture([buildWorktree('/tmp/repo', 'feature')]),
      okFixture('req_list', { worktree: 'repo::/tmp/repo', comments: [COMMENT] })
    )

    await main(['comment', 'list', 'notes/status.md'], '/tmp/repo/notes')

    expect(callMock).toHaveBeenNthCalledWith(2, 'comment.list', {
      worktree: 'id:repo::/tmp/repo',
      filePath: 'notes/status.md'
    })
    const output = vi.mocked(console.log).mock.calls[0][0]
    expect(output).toContain(`${COMMENT.id}  notes/status.md:12  markdown`)
    expect(output).toContain('on: Blocked on legal')
    expect(output).toContain('  Is this still blocked?\n  Need an answer today.')
  })

  it('passes --file and --source for an explicit worktree and prints the full JSON envelope', async () => {
    queueFixtures(callMock, okFixture('req_list', { worktree: 'wt-1', comments: [COMMENT] }))

    await main(
      [
        'comment',
        'list',
        '--file',
        'notes/status.md',
        '--source',
        'markdown',
        '--worktree',
        'id:wt-1',
        '--json'
      ],
      '/tmp/elsewhere'
    )

    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('comment.list', {
      worktree: 'id:wt-1',
      filePath: 'notes/status.md',
      source: 'markdown'
    })
    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(printed.result.comments[0]).toMatchObject({
      id: COMMENT.id,
      line: 12,
      body: COMMENT.body,
      createdAt: COMMENT.createdAt
    })
  })

  it('turns an absolute path inside the worktree into a worktree-relative one', async () => {
    queueFixtures(
      callMock,
      okFixture('req_show', { worktree: buildWorktree('/tmp/repo', 'feature') }),
      okFixture('req_list', { worktree: 'wt-1', comments: [] })
    )

    await main(
      ['comment', 'list', '--file', '/tmp/repo/notes/status.md', '--worktree', 'id:wt-1'],
      '/tmp/elsewhere'
    )

    expect(callMock).toHaveBeenNthCalledWith(2, 'comment.list', {
      worktree: 'id:wt-1',
      filePath: 'notes/status.md'
    })
    expect(vi.mocked(console.log).mock.calls[0][0]).toBe('No comments.')
  })

  it('rejects an unknown --source before calling the app', async () => {
    await main(['comment', 'list', '--source', 'pdf', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('Invalid --source')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('deletes by positional id, and treats delete and remove as the same command', async () => {
    for (const verb of ['rm', 'delete', 'remove']) {
      callMock.mockReset()
      queueFixtures(callMock, okFixture('req_rm', { worktree: 'wt-1', removed: COMMENT }))

      await main(['comment', verb, COMMENT.id, '--worktree', 'id:wt-1'], '/tmp/elsewhere')

      expect(callMock).toHaveBeenCalledWith('comment.rm', {
        worktree: 'id:wt-1',
        id: COMMENT.id
      })
    }
    expect(vi.mocked(console.log).mock.calls.at(-1)?.[0]).toBe(
      `Deleted comment ${COMMENT.id} (notes/status.md:12).`
    )
  })

  it('edits by id with the new body', async () => {
    queueFixtures(
      callMock,
      okFixture('req_edit', {
        worktree: 'wt-1',
        comment: { ...COMMENT, body: 'done' },
        changed: true
      })
    )

    await main(
      ['comment', 'edit', COMMENT.id, '--body', 'done', '--worktree', 'id:wt-1'],
      '/tmp/elsewhere'
    )

    expect(callMock).toHaveBeenCalledWith('comment.edit', {
      worktree: 'id:wt-1',
      id: COMMENT.id,
      body: 'done'
    })
    expect(vi.mocked(console.log).mock.calls[0][0]).toBe(
      `Updated comment ${COMMENT.id} (notes/status.md:12).`
    )
  })

  it('says so when an edit changes nothing', async () => {
    queueFixtures(
      callMock,
      okFixture('req_edit', { worktree: 'wt-1', comment: COMMENT, changed: false })
    )

    await main(
      ['comment', 'edit', COMMENT.id, '--body', COMMENT.body, '--worktree', 'id:wt-1'],
      '/tmp/elsewhere'
    )

    expect(vi.mocked(console.log).mock.calls[0][0]).toContain('nothing changed')
  })

  it('refuses a blank --body and a missing id without calling the app', async () => {
    await main(['comment', 'edit', COMMENT.id, '--body', '  ', '--worktree', 'id:wt-1'], '/tmp/r')
    await main(['comment', 'rm', '--worktree', 'id:wt-1'], '/tmp/r')

    expect(callMock).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('--body cannot be empty')
    expect(vi.mocked(console.error).mock.calls[1][0]).toContain('Missing required --id')
    process.exitCode = undefined
  })

  it('points to comment list when the id is unknown', async () => {
    callMock.mockRejectedValueOnce(new RuntimeClientError('comment_not_found', 'comment_not_found'))

    await main(['comment', 'rm', 'nope', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(console.log).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('No comment with id nope')
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('orca comment list')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('names the version gap when the running app predates comment commands', async () => {
    callMock.mockRejectedValueOnce(new RuntimeClientError('method_not_found', 'Unknown method'))

    await main(['comment', 'list', '--worktree', 'id:wt-1'], '/tmp/repo')

    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('Update Orca')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })
})
