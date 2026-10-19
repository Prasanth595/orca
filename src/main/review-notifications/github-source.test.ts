import { describe, expect, it, vi } from 'vitest'
import {
  listGitHubClosedReviewItems,
  listGitHubReviewItems,
  parseSlurpedPages,
  type GitHubApiRunner
} from './github-source'
import { resolveReviewNotificationEvents } from '../../shared/review-notification-types'

const provider = {
  kind: 'github' as const,
  enabled: true,
  owner: 'octocat',
  repo: 'hello-world',
  events: resolveReviewNotificationEvents(undefined)
}

const prFixture = [
  {
    number: 45,
    title: 'Fix race',
    html_url: 'https://github.com/octocat/hello-world/pull/45',
    user: { login: 'alice' },
    updated_at: '2026-10-19T10:00:00Z',
    draft: false
  }
]

const issueFixture = [
  {
    number: 46,
    title: 'Docs typo',
    html_url: 'https://github.com/octocat/hello-world/issues/46',
    user: { login: 'carol' },
    updated_at: '2026-10-19T09:00:00Z'
  },
  // The issues endpoint also returns PRs; they must be filtered out.
  {
    number: 45,
    title: 'Fix race',
    html_url: 'https://github.com/octocat/hello-world/pull/45',
    user: { login: 'alice' },
    updated_at: '2026-10-19T10:00:00Z',
    pull_request: { url: 'https://api.github.com/repos/octocat/hello-world/pulls/45' }
  }
]

function runnerFor(prs: unknown[], issues: unknown[]): GitHubApiRunner {
  return vi.fn(async (endpoint: string) => {
    if (endpoint.includes('/pulls')) {
      return prs
    }
    if (endpoint.includes('/issues')) {
      return issues
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
}

describe('github-source', () => {
  it('normalizes PRs to kind mr and filters PRs out of the issues list', async () => {
    const { mrs, issues } = await listGitHubReviewItems(
      provider,
      '2026-10-19T08:00:00Z',
      runnerFor(prFixture, issueFixture)
    )
    expect(mrs).toHaveLength(1)
    expect(mrs[0]).toMatchObject({
      provider: 'github',
      host: 'github.com',
      repo: 'octocat/hello-world',
      kind: 'mr',
      iid: 45,
      actor: 'alice'
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'issue', iid: 46 })
  })

  it('classifies 403 as auth and rate-limit text as rate_limited', async () => {
    const authRunner: GitHubApiRunner = async () => {
      throw Object.assign(new Error('403 Forbidden'), { stderr: 'HTTP 403: Forbidden' })
    }
    await expect(
      listGitHubReviewItems(provider, '2026-10-19T08:00:00Z', authRunner)
    ).rejects.toMatchObject({ kind: 'auth' })
    const rateRunner: GitHubApiRunner = async () => {
      throw Object.assign(new Error('abuse'), {
        stderr: 'You have exceeded a secondary rate limit'
      })
    }
    await expect(
      listGitHubReviewItems(provider, '2026-10-19T08:00:00Z', rateRunner)
    ).rejects.toMatchObject({ kind: 'rate_limited' })
  })

  it('passes since and the repo-qualified endpoints', async () => {
    const runner = runnerFor([], [])
    await listGitHubReviewItems(provider, '2026-10-19T08:00:00Z', runner)
    const endpoints = runner.mock.calls.map((c) => c[0])
    expect(endpoints.some((e) => e.includes('repos/octocat/hello-world/pulls'))).toBe(true)
    expect(endpoints.some((e) => e.includes('since='))).toBe(true)
  })

  it('classifies a 403 secondary rate limit as rate_limited, not auth', async () => {
    const runner: GitHubApiRunner = async () => {
      throw Object.assign(new Error('403'), {
        stderr: 'HTTP 403: You have exceeded a secondary rate limit.\nRetry-After: 60'
      })
    }
    await expect(
      listGitHubReviewItems(provider, '2026-10-19T08:00:00Z', runner)
    ).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 60000 })
  })

  it('parseSlurpedPages flattens --paginate --slurp output into one item array', () => {
    const page1 = [{ number: 1 }]
    const page2 = [{ number: 2 }, { number: 3 }]
    expect(parseSlurpedPages(JSON.stringify([page1, page2]))).toEqual([...page1, ...page2])
    // A single page stays a single array.
    expect(parseSlurpedPages(JSON.stringify([page1]))).toEqual(page1)
    // Non-array output degrades to empty rather than throwing downstream.
    expect(parseSlurpedPages(JSON.stringify({}))).toEqual([])
  })

  it('lists closed PRs and issues for resolve detection', async () => {
    const closedPr = {
      number: 45,
      title: 'Fix race',
      html_url: 'https://github.com/octocat/hello-world/pull/45',
      user: { login: 'alice' },
      updated_at: '2026-10-19T10:30:00Z',
      pull_request: { url: 'https://api.github.com/repos/octocat/hello-world/pulls/45' }
    }
    const closedIssue = {
      number: 46,
      title: 'Docs typo',
      html_url: 'https://github.com/octocat/hello-world/issues/46',
      user: { login: 'carol' },
      updated_at: '2026-10-19T10:31:00Z'
    }
    const runner: GitHubApiRunner = vi.fn(async (endpoint: string) => {
      expect(endpoint).toContain('state=closed')
      return [closedPr, closedIssue]
    })
    const { mrs, issues } = await listGitHubClosedReviewItems(
      provider,
      '2026-10-19T08:00:00Z',
      runner
    )
    expect(mrs).toHaveLength(1)
    expect(mrs[0]).toMatchObject({ kind: 'mr', iid: 45 })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'issue', iid: 46 })
  })
})
