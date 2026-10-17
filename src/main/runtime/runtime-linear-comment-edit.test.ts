import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as LinearClientModule from '../linear/client'

const COMMENT_ID = '9f3c2a10-1111-4222-8333-444455556666'

const mocks = vi.hoisted(() => ({
  getClients: vi.fn(),
  getStatus: vi.fn(),
  lookup: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn()
}))

vi.mock('../linear/client', async (importOriginal) => ({
  ...(await importOriginal<typeof LinearClientModule>()),
  getClients: mocks.getClients,
  getStatus: mocks.getStatus
}))

vi.mock('../linear/linear-sdk', () => ({
  loadLinearSdk: () => ({
    // Why: writes build a fresh SDK client per call so the deadline signal can abort it.
    LinearClient: class {
      client = {
        rawRequest: (_query: string, variables: { id: string }) => mocks.lookup('w2', variables)
      }
      updateComment = mocks.updateComment
      deleteComment = mocks.deleteComment
    },
    AuthenticationLinearError: class extends Error {}
  })
}))

import { RuntimeLinearReadCommands } from './runtime-linear-read-commands'

function rawComment(body: string): unknown {
  return {
    data: {
      comment: {
        id: COMMENT_ID,
        url: 'https://linear.app/acme/issue/ENG-1#comment-1',
        body,
        parent: null,
        issue: { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1' }
      }
    }
  }
}

function createCommands(emitClientEvent = vi.fn()): RuntimeLinearReadCommands {
  return new RuntimeLinearReadCommands({
    runtimeAvailable: () => true,
    showTerminal: async () => {
      throw new Error('unused')
    },
    resolveWorktreeSelector: async () => {
      throw new Error('unused')
    },
    listResolvedWorktrees: async () =>
      [{ id: 'wt-1', linkedLinearIssue: 'ENG-1', linkedLinearIssueWorkspaceId: 'w2' }] as never,
    setWorktreeMeta: () => {},
    emitClientEvent
  })
}

describe('Linear comment edit and delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStatus.mockReturnValue({ workspaces: [{ id: 'w1' }, { id: 'w2' }] })
    mocks.getClients.mockImplementation((workspaceId: string) => [
      {
        workspace: { id: workspaceId },
        apiKey: `key-${workspaceId}`,
        client: {
          client: {
            rawRequest: (_query: string, variables: { id: string }) =>
              mocks.lookup(workspaceId, variables)
          }
        }
      }
    ])
  })

  it('edits a comment in the workspace that owns it and refreshes its worktree', async () => {
    mocks.lookup.mockImplementation(async (workspaceId: string) => {
      if (workspaceId === 'w1') {
        throw new Error('Entity not found: Comment - Could not find referenced Comment.')
      }
      return rawComment(mocks.updateComment.mock.calls.length > 0 ? 'new body' : 'old body')
    })
    mocks.updateComment.mockResolvedValue({ success: true })
    const emitClientEvent = vi.fn()

    const result = await createCommands(emitClientEvent).linearCommentEdit({
      commentId: COMMENT_ID,
      body: 'new body'
    })

    expect(mocks.updateComment).toHaveBeenCalledWith(COMMENT_ID, { body: 'new body' })
    expect(result).toEqual({
      comment: {
        id: COMMENT_ID,
        url: 'https://linear.app/acme/issue/ENG-1#comment-1',
        parentId: null
      },
      issue: { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1' },
      meta: { workspaceId: 'w2', bodyChars: 8 }
    })
    expect(emitClientEvent).toHaveBeenCalledWith({
      type: 'linearLinkedIssueUpdated',
      worktreeId: 'wt-1',
      identifier: 'ENG-1',
      workspaceId: 'w2'
    })
  })

  it('deletes a found comment and refuses an id no workspace knows', async () => {
    mocks.lookup.mockResolvedValue(rawComment('body'))
    mocks.deleteComment.mockResolvedValue({ success: true })

    await expect(
      createCommands().linearCommentDelete({ commentId: COMMENT_ID, workspaceId: 'w2' })
    ).resolves.toMatchObject({ comment: { id: COMMENT_ID }, meta: { workspaceId: 'w2' } })
    expect(mocks.deleteComment).toHaveBeenCalledWith(COMMENT_ID)

    mocks.deleteComment.mockClear()
    mocks.lookup.mockResolvedValue({ data: { comment: null } })
    await expect(
      createCommands().linearCommentDelete({ commentId: COMMENT_ID })
    ).rejects.toMatchObject({ code: 'linear_comment_not_found' })
    expect(mocks.deleteComment).not.toHaveBeenCalled()
  })
})
