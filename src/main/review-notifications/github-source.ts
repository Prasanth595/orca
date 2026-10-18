import { extractExecError } from '../git/exec-error'
import { ghExecFileAsync } from '../git/command-runner/gh-exec-file'
import type { GitHubReviewNotificationProvider } from '../../shared/review-notification-types'
import type { ReviewEvent, ReviewNotificationAction } from './review-event'

export type GitHubSourceError = {
  kind: 'auth' | 'rate_limited' | 'network' | 'parse'
  retryAfterMs?: number
  message: string
}

/** Injected for tests; production uses ghExecFileAsync. */
export type GitHubApiRunner = (
  endpoint: string,
  provider: GitHubReviewNotificationProvider
) => Promise<unknown>

function classifyError(error: unknown): GitHubSourceError {
  const { stderr } = extractExecError(error)
  const text = stderr.toLowerCase()
  if (/\b(401|403)\b/.test(text)) {
    return { kind: 'auth', message: 'GitHub authentication failed (401/403). Check the gh token.' }
  }
  const rateLimited =
    /\b429\b/.test(text) || /rate limit|secondary rate limit|abuse detection/i.test(text)
  if (rateLimited) {
    const retryAfter = text.match(/retry-after[:\s]+(\d+)/i)
    return {
      kind: 'rate_limited',
      retryAfterMs: retryAfter ? Number(retryAfter[1]) * 1000 : undefined,
      message: 'GitHub rate limit hit.'
    }
  }
  return { kind: 'network', message: stderr.slice(0, 200) || 'GitHub request failed.' }
}

/**
 * Read-only: uses `gh api` (poll/read scopes only). github.com only in 1a;
 * GitHub Enterprise support is a fast follow-up.
 */
export function createGitHubApiRunner(): GitHubApiRunner {
  return async (endpoint) => {
    // Absolute API path carries the repo; default gh auth applies (github.com in 1a).
    const { stdout } = await ghExecFileAsync(['api', endpoint, '--paginate', '--method', 'GET'])
    return JSON.parse(stdout) as unknown
  }
}

type GitHubItem = {
  number: number
  title: string
  html_url: string
  user?: { login?: string }
  updated_at: string
  draft?: boolean
  pull_request?: unknown
  labels?: { name?: string }[]
  requested_reviewers?: { login?: string }[]
}

function toEvent(
  raw: Record<string, unknown>,
  kind: 'mr' | 'issue',
  provider: GitHubReviewNotificationProvider
): ReviewEvent | null {
  const item = raw as unknown as GitHubItem
  const number = Number(item.number)
  if (!Number.isFinite(number)) {
    return null
  }
  return {
    provider: 'github',
    host: 'github.com',
    repo: `${provider.owner}/${provider.repo}`,
    kind,
    action: 'opened' as ReviewNotificationAction,
    iid: number,
    actor: item.user?.login ?? '',
    title: String(item.title ?? ''),
    url: String(item.html_url ?? ''),
    updatedAt: String(item.updated_at ?? ''),
    meta: {
      draft: item.draft,
      labels: (item.labels ?? []).map((l) => String(l.name ?? '')).filter(Boolean),
      reviewers: (item.requested_reviewers ?? []).map((r) => String(r.login ?? '')).filter(Boolean)
    }
  }
}

/**
 * List open PRs and issues updated since `sinceIso` (read-only).
 * The issues endpoint returns PRs too; they are filtered out.
 */
export async function listGitHubReviewItems(
  provider: GitHubReviewNotificationProvider,
  sinceIso: string,
  runner: GitHubApiRunner = createGitHubApiRunner()
): Promise<{ mrs: ReviewEvent[]; issues: ReviewEvent[] }> {
  const slug = `${provider.owner}/${provider.repo}`
  const since = `?state=open&sort=updated&direction=asc&per_page=50&since=${encodeURIComponent(sinceIso)}`
  try {
    const [prRaw, issueRaw] = await Promise.all([
      runner(`repos/${slug}/pulls${since}`, provider),
      runner(`repos/${slug}/issues${since}`, provider)
    ])
    const mrs = (Array.isArray(prRaw) ? prRaw : [])
      .map((r) => toEvent(r as Record<string, unknown>, 'mr', provider))
      .filter((e): e is ReviewEvent => e !== null)
    const issues = (Array.isArray(issueRaw) ? issueRaw : [])
      .filter((r) => !(r as Record<string, unknown>).pull_request)
      .map((r) => toEvent(r as Record<string, unknown>, 'issue', provider))
      .filter((e): e is ReviewEvent => e !== null)
    return { mrs, issues }
  } catch (error) {
    if (error && typeof error === 'object' && 'kind' in error) {
      throw error
    }
    throw classifyError(error)
  }
}
