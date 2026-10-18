import { extractExecError } from '../git/exec-error'
import { glabExecFileAsync } from '../git/command-runner/glab-exec-file'
import type { GitLabReviewNotificationProvider } from '../../shared/review-notification-types'
import type { ReviewEvent, ReviewNotificationAction } from './review-event'

/**
 * Raw list items returned by the GitLab source before transition
 * classification. `updatedAt` is the provider's ISO timestamp.
 */
export type GitLabListItem = {
  iid: number
  title: string
  webUrl: string
  authorUsername: string
  updatedAt: string
  draft: boolean
  mergeStatus: string
  labels: string[]
  reviewers: string[]
  descriptionExcerpt: string
}

export type GitLabSourceError = {
  kind: 'auth' | 'rate_limited' | 'network' | 'parse'
  retryAfterMs?: number
  message: string
}

/** Injected for tests; production uses glabExecFileAsync via glab api. */
export type GitLabApiRunner = (
  path: string,
  provider: GitLabReviewNotificationProvider
) => Promise<unknown>

export function hostnameFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0]
  }
}

function requireHttps(provider: GitLabReviewNotificationProvider): string {
  const raw = provider.baseUrl.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw { kind: 'network', message: `Invalid GitLab baseUrl: ${raw}` } as GitLabSourceError
  }
  if (url.protocol !== 'https:' && !provider.insecureHttp) {
    throw {
      kind: 'network',
      message: `GitLab baseUrl must be https (got ${url.protocol}); set insecureHttp only for lab environments.`
    } as GitLabSourceError
  }
  return url.hostname
}

function classifyError(error: unknown): GitLabSourceError {
  const { stderr } = extractExecError(error)
  const text = stderr.toLowerCase()
  if (/\b(401|403)\b/.test(text)) {
    return {
      kind: 'auth',
      message: 'GitLab authentication failed (401/403). Check the glab token.'
    }
  }
  const rateLimited = /\b429\b/.test(text) || /rate limit/i.test(text)
  if (rateLimited) {
    const retryAfter = text.match(/retry-after[:\s]+(\d+)/i)
    return {
      kind: 'rate_limited',
      retryAfterMs: retryAfter ? Number(retryAfter[1]) * 1000 : undefined,
      message: 'GitLab rate limit hit (429).'
    }
  }
  return { kind: 'network', message: stderr.slice(0, 200) || 'GitLab request failed.' }
}

export function createGitLabApiRunner(): GitLabApiRunner {
  return async (path, provider) => {
    const hostname = hostnameFromBaseUrl(provider.baseUrl.trim())
    const { stdout } = await glabExecFileAsync([
      'api',
      path,
      '--hostname',
      hostname,
      '--method',
      'GET'
    ])
    return JSON.parse(stdout) as unknown
  }
}

function toListItem(raw: Record<string, unknown>): GitLabListItem | null {
  const iid = Number(raw.iid)
  if (!Number.isFinite(iid)) {
    return null
  }
  const author = raw.author as { username?: unknown } | undefined
  return {
    iid,
    title: String(raw.title ?? ''),
    webUrl: String(raw.web_url ?? ''),
    authorUsername: typeof author?.username === 'string' ? author.username : '',
    updatedAt: String(raw.updated_at ?? ''),
    draft: Boolean(raw.draft),
    mergeStatus: String(raw.merge_status ?? ''),
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    reviewers: Array.isArray(raw.reviewers)
      ? (raw.reviewers as { username?: unknown }[]).map((r) => String(r.username ?? ''))
      : [],
    descriptionExcerpt: String(raw.description ?? '').slice(0, 300)
  }
}

function toEvent(
  item: GitLabListItem,
  kind: 'mr' | 'issue',
  provider: GitLabReviewNotificationProvider
): ReviewEvent {
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '')
  const host = hostnameFromBaseUrl(baseUrl)
  const repo = `${host}/projects/${provider.projectId}`
  const path = kind === 'mr' ? 'merge_requests' : 'issues'
  return {
    provider: 'gitlab',
    host,
    repo,
    kind,
    action: 'opened' as ReviewNotificationAction,
    iid: item.iid,
    actor: item.authorUsername,
    title: item.title,
    url: item.webUrl || `${baseUrl}/-/${path}/${item.iid}`,
    updatedAt: item.updatedAt,
    meta: {
      draft: item.draft,
      labels: item.labels,
      reviewers: item.reviewers
    }
  }
}

function sinceParam(since: string): string {
  return `&updated_after=${encodeURIComponent(since)}`
}

/**
 * List open MRs and issues updated since `sinceIso` (read-only).
 * Errors are classified so the poller can back off quietly.
 */
export async function listGitLabReviewItems(
  provider: GitLabReviewNotificationProvider,
  sinceIso: string,
  runner: GitLabApiRunner = createGitLabApiRunner()
): Promise<{ mrs: ReviewEvent[]; issues: ReviewEvent[] }> {
  // Validate before any network call, regardless of the injected runner.
  requireHttps(provider)
  const project = `projects/${provider.projectId}`
  const params = `?state=opened&order_by=updated_at&sort=asc&per_page=50${sinceParam(sinceIso)}`
  try {
    const [mrRaw, issueRaw] = await Promise.all([
      runner(`${project}/merge_requests${params}`, provider),
      runner(`${project}/issues${params}`, provider)
    ])
    const mrs = (Array.isArray(mrRaw) ? mrRaw : [])
      .map((r) => toListItem(r as Record<string, unknown>))
      .filter((i): i is GitLabListItem => i !== null)
      .map((i) => toEvent(i, 'mr', provider))
    const issues = (Array.isArray(issueRaw) ? issueRaw : [])
      .map((r) => toListItem(r as Record<string, unknown>))
      .filter((i): i is GitLabListItem => i !== null)
      .map((i) => toEvent(i, 'issue', provider))
    return { mrs, issues }
  } catch (error) {
    if (error && typeof error === 'object' && 'kind' in error) {
      throw error
    }
    throw classifyError(error)
  }
}
