import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _clearGitHubPRRefreshStartedEntriesForTest } from '../github/request-coordination'
import {
  createTestStore,
  makePR,
  makePRRefreshWorktree,
  mockApi,
  resetRemoteRuntimeMocks
} from './github-slice-test-harness'
import type { PRRefreshOutcome } from '../../../../shared/github/pull-request-refresh-types'
import { hostedReviewInfoFromGitHubPRInfo } from '../../../../shared/hosted-review-github'

describe('manual PR refresh whose outcome main also broadcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
    mockApi.gh.refreshPRNow.mockReset()
    mockApi.hostedReview.forBranch.mockResolvedValue(null)
    _clearGitHubPRRefreshStartedEntriesForTest()
  })

  afterEach(() => {
    _clearGitHubPRRefreshStartedEntriesForTest()
    vi.useRealTimers()
  })

  it('keeps a PR opened outside Orca in the PR cache after Refresh finds it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const store = createTestStore()
    const repoPath = '/repo'
    const repoId = 'repo-1'
    const branch = 'feature/agent-made'
    const worktreeId = 'wt-agent-made'
    const cacheKey = `${repoId}::${branch}`
    const alias = { cacheKey, repoId, repoPath, branch, worktreeId }
    const outcome: PRRefreshOutcome = { kind: 'found', pr: makePR({ number: 6 }), fetchedAt: 1_300 }
    store.setState({
      repos: [
        { id: repoId, path: repoPath, displayName: 'repo', badgeColor: '', addedAt: 1, kind: 'git' }
      ],
      worktreesByRepo: {
        [repoId]: [makePRRefreshWorktree({ id: worktreeId, repoId, branch, head: 'head-oid' })]
      },
      // Orca already saw this branch with no PR, so the refresh carries no PR-number hint.
      prCache: { [cacheKey]: { data: null, fetchedAt: 500 } }
    })
    // Main sends the in-flight and outcome events to the window before the IPC reply lands.
    mockApi.gh.refreshPRNow.mockImplementationOnce(async () => {
      store.getState().applyGitHubPRRefreshEvent({
        sequence: 1,
        aliases: [alias],
        reason: 'manual',
        requestStartedAt: 1_100,
        status: 'in-flight'
      })
      store.getState().applyGitHubPRRefreshEvent({
        sequence: 1,
        aliases: [alias],
        reason: 'manual',
        requestStartedAt: 1_100,
        outcome
      })
      return outcome
    })

    await store.getState().fetchPRForBranch(repoPath, branch, { force: true, repoId, worktreeId })

    expect(store.getState().prCache[cacheKey]).toMatchObject({
      data: expect.objectContaining({ number: 6 }),
      fetchedAt: 1_300
    })
  })

  it.each([
    ['drops the PR when a newer lookup found no review', null, undefined],
    [
      'keeps the PR when a newer lookup found the same one',
      hostedReviewInfoFromGitHubPRInfo(makePR({ number: 6 })),
      6
    ]
  ])('%s between the broadcast and the reply', async (_name, newerReview, expectedPR) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const store = createTestStore()
    const repoPath = '/repo'
    const repoId = 'repo-1'
    const branch = 'feature/agent-made'
    const worktreeId = 'wt-agent-made'
    const cacheKey = `${repoId}::${branch}`
    const alias = { cacheKey, repoId, repoPath, branch, worktreeId }
    const outcome: PRRefreshOutcome = { kind: 'found', pr: makePR({ number: 6 }), fetchedAt: 1_300 }
    store.setState({
      repos: [
        { id: repoId, path: repoPath, displayName: 'repo', badgeColor: '', addedAt: 1, kind: 'git' }
      ],
      worktreesByRepo: {
        [repoId]: [makePRRefreshWorktree({ id: worktreeId, repoId, branch, head: 'head-oid' })]
      },
      prCache: { [cacheKey]: { data: null, fetchedAt: 500 } }
    })
    mockApi.hostedReview.forBranch.mockResolvedValue(newerReview)
    mockApi.gh.refreshPRNow.mockImplementationOnce(async () => {
      store.getState().applyGitHubPRRefreshEvent({
        sequence: 1,
        aliases: [alias],
        reason: 'manual',
        requestStartedAt: 1_100,
        outcome
      })
      vi.setSystemTime(2_000)
      await store.getState().fetchHostedReviewForBranch(repoPath, branch, { force: true, repoId })
      return outcome
    })

    await store.getState().fetchPRForBranch(repoPath, branch, { force: true, repoId, worktreeId })

    const hostedReviews = Object.values(store.getState().hostedReviewCache)
    expect(hostedReviews.map((entry) => entry.data?.number ?? null)).toEqual([expectedPR ?? null])
    expect(store.getState().prCache[cacheKey]?.data?.number).toBe(expectedPR)
  })
})
