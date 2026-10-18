import { describe, expect, it, vi } from 'vitest'
import { listGitLabReviewItems, type GitLabApiRunner } from './gitlab-source'
import { resolveReviewNotificationEvents } from '../../shared/review-notification-types'

const provider = {
  kind: 'gitlab' as const,
  enabled: true,
  baseUrl: 'https://gitlab.example.com',
  projectId: 42,
  events: resolveReviewNotificationEvents(undefined)
}

const mrFixture = [
  {
    iid: 7,
    title: 'Add search',
    web_url: 'https://gitlab.example.com/group/proj/-/merge_requests/7',
    author: { username: 'alice' },
    updated_at: '2026-10-19T10:00:00Z',
    draft: false,
    merge_status: 'can_be_merged',
    labels: ['review-needed'],
    reviewers: [{ username: 'bob' }],
    description: 'Adds full-text search.'
  }
]

const issueFixture = [
  {
    iid: 3,
    title: 'Crash on login',
    web_url: 'https://gitlab.example.com/group/proj/-/issues/3',
    author: { username: 'carol' },
    updated_at: '2026-10-19T09:00:00Z',
    labels: [],
    description: 'Steps to reproduce...'
  }
]

function runnerFor(mrs: unknown[], issues: unknown[]): GitLabApiRunner {
  return vi.fn(async (path: string) => {
    if (path.includes('/merge_requests')) {
      return mrs
    }
    if (path.includes('/issues')) {
      return issues
    }
    throw new Error(`unexpected path ${path}`)
  })
}

describe('gitlab-source', () => {
  it('normalizes MR and issue lists into review events', async () => {
    const { mrs, issues } = await listGitLabReviewItems(
      provider,
      '2026-10-19T08:00:00Z',
      runnerFor(mrFixture, issueFixture)
    )
    expect(mrs).toHaveLength(1)
    expect(mrs[0]).toMatchObject({
      provider: 'gitlab',
      host: 'gitlab.example.com',
      kind: 'mr',
      iid: 7,
      actor: 'alice',
      title: 'Add search'
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'issue', iid: 3, actor: 'carol' })
  })

  it('skips items with unusable iids', async () => {
    const { mrs } = await listGitLabReviewItems(
      provider,
      '2026-10-19T08:00:00Z',
      runnerFor([{ ...mrFixture[0], iid: 'nope' }], [])
    )
    expect(mrs).toHaveLength(0)
  })

  it('classifies 401 as auth and 429 as rate_limited', async () => {
    const authRunner: GitLabApiRunner = async () => {
      throw Object.assign(new Error('glab: ERROR: http 401: Unauthorized'), {
        stderr: 'ERROR: http 401: Unauthorized'
      })
    }
    await expect(
      listGitLabReviewItems(provider, '2026-10-19T08:00:00Z', authRunner)
    ).rejects.toMatchObject({ kind: 'auth' })
    const rateRunner: GitLabApiRunner = async () => {
      throw Object.assign(new Error('429 Too Many Requests'), {
        stderr: 'ERROR: http 429: Too Many Requests'
      })
    }
    await expect(
      listGitLabReviewItems(provider, '2026-10-19T08:00:00Z', rateRunner)
    ).rejects.toMatchObject({ kind: 'rate_limited' })
  })

  it('rejects non-https baseUrl unless insecureHttp is set', async () => {
    const httpProvider = { ...provider, baseUrl: 'http://gitlab.internal' }
    await expect(
      listGitLabReviewItems(httpProvider, '2026-10-19T08:00:00Z', runnerFor([], []))
    ).rejects.toMatchObject({ kind: 'network' })
    const insecure = { ...httpProvider, insecureHttp: true }
    const { mrs } = await listGitLabReviewItems(insecure, '2026-10-19T08:00:00Z', runnerFor([], []))
    expect(mrs).toHaveLength(0)
  })

  it('passes updated_after and hostname-qualified paths to glab api', async () => {
    const runner = runnerFor([], [])
    await listGitLabReviewItems(provider, '2026-10-19T08:00:00Z', runner)
    const paths = runner.mock.calls.map((call) => call[0])
    expect(paths.some((p) => p.includes('projects/42/merge_requests'))).toBe(true)
    expect(paths.some((p) => p.includes('updated_after='))).toBe(true)
  })
})
