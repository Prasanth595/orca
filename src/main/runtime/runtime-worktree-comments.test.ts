import { describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../shared/diff-comment-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import {
  editRuntimeWorktreeComment,
  listRuntimeWorktreeComments,
  removeRuntimeWorktreeComment,
  toRuntimeCommentRecord
} from './runtime-worktree-comments'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'

const WORKTREE_ID = 'repo-1::/workspace/app'

function comment(overrides: Partial<DiffComment> & Pick<DiffComment, 'id'>): DiffComment {
  return {
    worktreeId: WORKTREE_ID,
    filePath: 'notes/status.md',
    source: 'markdown',
    lineNumber: 4,
    body: 'Is this still blocked?',
    createdAt: 1_000,
    side: 'modified',
    ...overrides
  }
}

function worktree(overrides: Record<string, unknown> = {}): ResolvedWorktree {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the comment code reads only id, repoId, hostId and identity.
  return {
    id: WORKTREE_ID,
    repoId: 'repo-1',
    path: '/workspace/app',
    ...overrides
  } as ResolvedWorktree
}

function emptyMeta(overrides: Partial<WorktreeMeta> = {}): WorktreeMeta {
  return {
    displayName: '',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

function setup(initial: DiffComment[] | undefined, resolved = worktree()) {
  const meta = emptyMeta(initial === undefined ? {} : { diffComments: initial })
  const setWorktreeMeta = vi.fn((_id: string, updates: Partial<WorktreeMeta>) => {
    Object.assign(meta, updates)
    return meta
  })
  const setWorktreeMetaForHost = vi.fn(
    (_id: string, _host: string, updates: Partial<WorktreeMeta>) => {
      Object.assign(meta, updates)
      return meta
    }
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the comment code reads only these store members.
  const store = {
    getRepos: () => [],
    getWorktreeMeta: () => meta,
    getWorktreeMetaForHost: () => meta,
    setWorktreeMeta,
    setWorktreeMetaForHost
  } as unknown as RuntimeStore
  const ports = {
    resolveWorktree: vi.fn(async () => resolved),
    invalidateResolved: vi.fn(),
    notifyChanged: vi.fn()
  }
  return { meta, store, ports, setWorktreeMeta, setWorktreeMetaForHost }
}

describe('toRuntimeCommentRecord', () => {
  it('renames lineNumber to line, treats a note with no source as a diff note, and omits unset fields', () => {
    const legacy = comment({ id: 'a', source: undefined, lineNumber: 9 })
    expect(toRuntimeCommentRecord(legacy)).toEqual({
      id: 'a',
      filePath: 'notes/status.md',
      source: 'diff',
      line: 9,
      body: 'Is this still blocked?',
      createdAt: 1_000
    })
  })

  it('keeps range, selected text and the sent mark when set', () => {
    const full = comment({
      id: 'b',
      startLine: 2,
      lineNumber: 4,
      selectedText: 'Blocked on legal',
      updatedAt: 2_000,
      sentAt: 3_000
    })
    expect(toRuntimeCommentRecord(full)).toMatchObject({
      startLine: 2,
      line: 4,
      selectedText: 'Blocked on legal',
      updatedAt: 2_000,
      sentAt: 3_000
    })
  })
})

describe('listRuntimeWorktreeComments', () => {
  const stored = [
    comment({ id: 'late', lineNumber: 20, createdAt: 1 }),
    comment({ id: 'early', lineNumber: 2, createdAt: 2 }),
    comment({ id: 'other-file', filePath: 'docs/plan.md', lineNumber: 1 }),
    comment({ id: 'diff-note', source: 'diff', filePath: 'src/app.ts', lineNumber: 7 })
  ]

  it('lists every comment in the worktree, file by file and top to bottom', async () => {
    const { store, ports } = setup(stored)
    const result = await listRuntimeWorktreeComments({ selector: 'active', store, ports })
    expect(result.worktree).toBe(WORKTREE_ID)
    expect(result.comments.map((entry) => entry.id)).toEqual([
      'other-file',
      'early',
      'late',
      'diff-note'
    ])
  })

  it('narrows to one file, ignoring a leading ./ or backslashes in the typed path', async () => {
    const { store, ports } = setup(stored)
    for (const filePath of ['notes/status.md', './notes/status.md', 'notes\\status.md']) {
      const result = await listRuntimeWorktreeComments({
        selector: 'active',
        filePath,
        store,
        ports
      })
      expect(result.comments.map((entry) => entry.id)).toEqual(['early', 'late'])
    }
  })

  it('narrows by source', async () => {
    const { store, ports } = setup(stored)
    const result = await listRuntimeWorktreeComments({
      selector: 'active',
      source: 'diff',
      store,
      ports
    })
    expect(result.comments.map((entry) => entry.id)).toEqual(['diff-note'])
  })

  it('returns an empty list when the worktree has no saved comments', async () => {
    const { store, ports } = setup(undefined)
    const result = await listRuntimeWorktreeComments({ selector: 'active', store, ports })
    expect(result.comments).toEqual([])
  })

  it('reads the saved list, not the possibly stale resolved worktree', async () => {
    const { store, ports } = setup(
      [comment({ id: 'fresh' })],
      worktree({ diffComments: [comment({ id: 'stale' })] })
    )
    const result = await listRuntimeWorktreeComments({ selector: 'active', store, ports })
    expect(result.comments.map((entry) => entry.id)).toEqual(['fresh'])
  })
})

describe('removeRuntimeWorktreeComment', () => {
  it('saves the list without the comment, then tells the window', async () => {
    const { meta, store, ports, setWorktreeMeta } = setup([
      comment({ id: 'keep-1' }),
      comment({ id: 'drop', body: 'handled' }),
      comment({ id: 'keep-2' })
    ])

    const result = await removeRuntimeWorktreeComment({
      selector: 'active',
      id: 'drop',
      store,
      ports
    })

    expect(result.worktree).toBe(WORKTREE_ID)
    expect(result.removed).toMatchObject({ id: 'drop', body: 'handled' })
    expect(setWorktreeMeta).toHaveBeenCalledTimes(1)
    expect(meta.diffComments?.map((entry) => entry.id)).toEqual(['keep-1', 'keep-2'])
    expect(ports.invalidateResolved).toHaveBeenCalledTimes(1)
    expect(ports.notifyChanged).toHaveBeenCalledWith('repo-1')
  })

  it('saves an empty list when the last comment goes', async () => {
    const { meta, store, ports } = setup([comment({ id: 'only' })])
    await removeRuntimeWorktreeComment({ selector: 'active', id: 'only', store, ports })
    expect(meta.diffComments).toEqual([])
  })

  it('fails with comment_not_found and writes nothing for an unknown id', async () => {
    const { store, ports, setWorktreeMeta } = setup([comment({ id: 'a' })])
    await expect(
      removeRuntimeWorktreeComment({ selector: 'active', id: 'missing', store, ports })
    ).rejects.toThrow('comment_not_found')
    expect(setWorktreeMeta).not.toHaveBeenCalled()
    expect(ports.notifyChanged).not.toHaveBeenCalled()
  })

  it('writes through the execution host that owns the worktree', async () => {
    const { store, ports, setWorktreeMeta, setWorktreeMetaForHost } = setup(
      [comment({ id: 'a' })],
      worktree({ hostId: 'ssh:build-box' })
    )
    await removeRuntimeWorktreeComment({ selector: 'active', id: 'a', store, ports })
    expect(setWorktreeMetaForHost).toHaveBeenCalledWith(WORKTREE_ID, 'ssh:build-box', {
      diffComments: []
    })
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('keeps a comment the window saved while the selector was still resolving', async () => {
    const { meta, store, ports } = setup([comment({ id: 'drop' })])
    ports.resolveWorktree.mockImplementation(async () => {
      meta.diffComments = [...(meta.diffComments ?? []), comment({ id: 'just-added' })]
      return worktree()
    })

    await removeRuntimeWorktreeComment({ selector: 'active', id: 'drop', store, ports })

    expect(meta.diffComments?.map((entry) => entry.id)).toEqual(['just-added'])
  })

  it('refuses a folder workspace instance removed while the selector was resolving', async () => {
    const folderInstanceId =
      'repo-1::/workspace/app::workspace:0b6f6d2e-1c1d-4c55-9a51-3f1c0f4f2a10'
    const { store, ports, setWorktreeMeta } = setup(
      undefined,
      worktree({ id: folderInstanceId, hostId: 'local' })
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the members the removal check reads are stubbed.
    const removedStore = {
      ...store,
      getRepos: () => [
        { id: 'repo-1', path: '/workspace/app', displayName: 'app', kind: 'folder' }
      ],
      getWorktreeMeta: () => undefined,
      getWorktreeMetaForHost: () => undefined
    } as unknown as RuntimeStore

    await expect(
      removeRuntimeWorktreeComment({ selector: 'active', id: 'a', store: removedStore, ports })
    ).rejects.toThrow('selector_not_found')
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })
})

describe('editRuntimeWorktreeComment', () => {
  it('replaces the text, trims it, clears the sent mark and keeps every other field', async () => {
    const { meta, store, ports } = setup([
      comment({
        id: 'target',
        body: 'old',
        sentAt: 5_000,
        startLine: 3,
        lineNumber: 4,
        selectedText: 'anchor'
      }),
      comment({ id: 'neighbour', sentAt: 5_000 })
    ])

    const result = await editRuntimeWorktreeComment({
      selector: 'active',
      id: 'target',
      body: '  done  ',
      store,
      ports
    })

    expect(result.changed).toBe(true)
    expect(result.comment).toEqual({
      id: 'target',
      filePath: 'notes/status.md',
      source: 'markdown',
      line: 4,
      startLine: 3,
      selectedText: 'anchor',
      body: 'done',
      createdAt: 1_000
    })
    expect(meta.diffComments?.[0]).not.toHaveProperty('sentAt')
    expect(meta.diffComments?.[1]).toMatchObject({ id: 'neighbour', sentAt: 5_000 })
    expect(ports.notifyChanged).toHaveBeenCalledWith('repo-1')
  })

  it('writes and notifies nothing when the text is already saved', async () => {
    const { store, ports, setWorktreeMeta } = setup([comment({ id: 'a', body: 'same', sentAt: 9 })])

    const result = await editRuntimeWorktreeComment({
      selector: 'active',
      id: 'a',
      body: ' same ',
      store,
      ports
    })

    expect(result.changed).toBe(false)
    expect(result.comment.sentAt).toBe(9)
    expect(setWorktreeMeta).not.toHaveBeenCalled()
    expect(ports.notifyChanged).not.toHaveBeenCalled()
  })

  it('fails with comment_not_found for an unknown id', async () => {
    const { store, ports, setWorktreeMeta } = setup([comment({ id: 'a' })])
    await expect(
      editRuntimeWorktreeComment({ selector: 'active', id: 'nope', body: 'x', store, ports })
    ).rejects.toThrow('comment_not_found')
    expect(setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses a blank body before touching anything', async () => {
    const { store, ports } = setup([comment({ id: 'a' })])
    await expect(
      editRuntimeWorktreeComment({ selector: 'active', id: 'a', body: '   ', store, ports })
    ).rejects.toThrow('invalid_argument')
    expect(ports.resolveWorktree).not.toHaveBeenCalled()
  })
})
