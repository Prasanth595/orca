import './rpc/unused-default-rpc-methods.test-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../shared/diff-comment-types'
import { Store } from '../persistence/loading-store/store'
import { ProfileStateSqliteAuthority } from '../persistence/profile-state/profile-state-sqlite-authority'
import { OrcaRuntimeService } from './orca-runtime'
import { RpcDispatcher } from './rpc/dispatcher'
import { COMMENT_METHODS } from './rpc/methods/comment'

const REPO_ID = 'repo-comments'
const PROFILE_ID = 'comment-persistence'

const directories: string[] = []
const stores: Store[] = []
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.freezeWrites()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function note(id: string, lineNumber: number, body: string, sentAt?: number): DiffComment {
  return {
    id,
    worktreeId: `${REPO_ID}::root`,
    filePath: 'notes/status.md',
    source: 'markdown',
    lineNumber,
    body,
    createdAt: lineNumber,
    ...(sentAt === undefined ? {} : { sentAt }),
    side: 'modified'
  }
}

/** The app's real profile store on disk in a throwaway directory, behind the real runtime. */
function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-comment-persistence-'))
  directories.push(directory)
  const databaseFile = join(directory, 'profile-state.db')
  const store = new Store({
    dataFile: join(directory, 'orca-data.json'),
    profileStateAuthority: new ProfileStateSqliteAuthority(databaseFile, PROFILE_ID)
  })
  stores.push(store)
  // Why a folder repo: its root workspace resolves without git.
  store.addRepo({
    id: REPO_ID,
    path: directory,
    displayName: 'Notes',
    badgeColor: 'gray',
    addedAt: 1,
    kind: 'folder'
  })
  const worktreeId = `${REPO_ID}::${directory}`
  store.setWorktreeMeta(worktreeId, {
    diffComments: [
      note('first', 2, 'is this blocked?', 99),
      note('second', 8, 'second note'),
      { ...note('on-code', 3, 'diff note'), filePath: 'src/app.ts', source: 'diff' }
    ]
  })
  store.flushOrThrow()
  const runtime = new OrcaRuntimeService(store)
  const worktreesChanged = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the comment commands call only worktreesChanged on the notifier.
  runtime.setNotifier({ worktreesChanged } as never)
  const dispatcher = new RpcDispatcher({ runtime, methods: COMMENT_METHODS })
  const call = (method: string, params: Record<string, unknown>) =>
    dispatcher.dispatch({
      id: 'req-1',
      authToken: 'tok',
      method,
      params: { worktree: `id:${worktreeId}`, ...params }
    })
  // Why a second reader: it sees what a restarted app would load, not the store's memory.
  const savedComments = (): DiffComment[] => {
    store.flushOrThrow()
    const reader = new ProfileStateSqliteAuthority(databaseFile, PROFILE_ID)
    try {
      const saved: { worktreeMeta?: Record<string, { diffComments?: DiffComment[] }> } = JSON.parse(
        reader.readSerializedState() ?? '{}'
      )
      return saved.worktreeMeta?.[worktreeId]?.diffComments ?? []
    } finally {
      reader.close()
    }
  }
  return { call, savedComments, worktreesChanged, worktreeId }
}

describe('comment commands against a real store', () => {
  it('lists the comments the store holds for one file', async () => {
    const { call } = createHarness()

    const response = await call('comment.list', { filePath: 'notes/status.md' })

    expect(response).toMatchObject({
      ok: true,
      result: {
        comments: [
          { id: 'first', line: 2 },
          { id: 'second', line: 8 }
        ]
      }
    })
  })

  it('removes a comment from the saved profile through the store and tells the window', async () => {
    const { call, savedComments, worktreesChanged } = createHarness()
    expect(savedComments().map((comment) => comment.id)).toEqual(['first', 'second', 'on-code'])

    const response = await call('comment.rm', { id: 'first' })

    expect(response).toMatchObject({ ok: true, result: { removed: { id: 'first' } } })
    expect(savedComments().map((comment) => comment.id)).toEqual(['second', 'on-code'])
    expect(worktreesChanged).toHaveBeenCalledWith(REPO_ID, undefined, {
      invalidateGitScans: false
    })
  })

  it('saves an edited body, drops the sent mark, and leaves the other comments as they were', async () => {
    const { call, savedComments } = createHarness()

    const response = await call('comment.edit', { id: 'first', body: ' done ' })

    expect(response).toMatchObject({ ok: true, result: { changed: true } })
    const [edited, untouched] = savedComments()
    expect(edited).toMatchObject({ id: 'first', body: 'done', lineNumber: 2 })
    expect(edited).not.toHaveProperty('sentAt')
    expect(untouched).toMatchObject({ id: 'second', body: 'second note' })
  })

  it('reports an unknown id as comment_not_found and leaves the saved file alone', async () => {
    const { call, savedComments, worktreesChanged } = createHarness()

    const response = await call('comment.rm', { id: 'nope' })

    expect(response).toMatchObject({ ok: false, error: { code: 'comment_not_found' } })
    expect(savedComments()).toHaveLength(3)
    expect(worktreesChanged).not.toHaveBeenCalled()
  })
})
