import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService, listWorktrees } from '../orca-runtime-test-mocks.spec'
import type { WorktreeMeta } from '../orca-runtime-test-mocks.spec'
import {
  TEST_WORKTREE_ID,
  TEST_WORKTREE_PATH,
  makeWorktreeMeta,
  store
} from '../orca-runtime-test-fixtures.spec'

function note(id: string, lineNumber: number, body: string) {
  return {
    id,
    worktreeId: TEST_WORKTREE_ID,
    filePath: 'notes/status.md',
    source: 'markdown' as const,
    lineNumber,
    body,
    createdAt: lineNumber,
    side: 'modified' as const
  }
}

function setup() {
  const metaById: Record<string, WorktreeMeta> = {
    [TEST_WORKTREE_ID]: makeWorktreeMeta({
      diffComments: [note('first', 2, 'first note'), note('second', 8, 'second note')]
    })
  }
  const runtimeStore = {
    ...store,
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (worktreeId: string) => metaById[worktreeId],
    setWorktreeMeta: (worktreeId: string, meta: Partial<WorktreeMeta>) => {
      metaById[worktreeId] = { ...metaById[worktreeId], ...meta }
      return metaById[worktreeId]
    }
  }
  vi.mocked(listWorktrees).mockResolvedValue([
    {
      path: TEST_WORKTREE_PATH,
      head: 'abc',
      branch: 'refs/heads/feature/status',
      isBare: false,
      isMainWorktree: false
    }
  ])
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runtime reads only the stubbed store members, as in the sibling runtime specs.
  const runtime = new OrcaRuntimeService(runtimeStore as never)
  const notifier = { worktreesChanged: vi.fn() }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the runtime calls only worktreesChanged on its notifier here.
  runtime.setNotifier(notifier as never)
  return { runtime, notifier, metaById }
}

describe('OrcaRuntimeService worktree comments', () => {
  it('lists the saved comments of the worktree a selector names', async () => {
    const { runtime } = setup()

    const result = await runtime.listWorktreeComments({
      selector: 'branch:feature/status',
      filePath: 'notes/status.md'
    })

    expect(result.worktree).toBe(TEST_WORKTREE_ID)
    expect(result.comments.map((comment) => [comment.id, comment.line])).toEqual([
      ['first', 2],
      ['second', 8]
    ])
  })

  it('saves a removal and a text change, then pushes a refresh without a git rescan', async () => {
    const { runtime, notifier, metaById } = setup()

    await runtime.removeWorktreeComment({ selector: `id:${TEST_WORKTREE_ID}`, id: 'first' })
    await runtime.editWorktreeComment({
      selector: `id:${TEST_WORKTREE_ID}`,
      id: 'second',
      body: 'done'
    })

    expect(metaById[TEST_WORKTREE_ID].diffComments).toEqual([{ ...note('second', 8, 'done') }])
    expect(notifier.worktreesChanged).toHaveBeenCalledTimes(2)
    expect(notifier.worktreesChanged).toHaveBeenCalledWith('repo-1', undefined, {
      invalidateGitScans: false
    })
  })

  it('leaves the saved list alone when the id is unknown', async () => {
    const { runtime, notifier, metaById } = setup()

    await expect(
      runtime.removeWorktreeComment({ selector: `id:${TEST_WORKTREE_ID}`, id: 'nope' })
    ).rejects.toThrow('comment_not_found')

    expect(metaById[TEST_WORKTREE_ID].diffComments).toHaveLength(2)
    expect(notifier.worktreesChanged).not.toHaveBeenCalled()
  })
})
