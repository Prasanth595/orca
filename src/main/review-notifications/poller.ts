import type { Repo } from '../../shared/repo-types'
import {
  isReviewNotificationPollingEnabled,
  resolveReviewNotificationConfig,
  type ReviewNotificationConfig,
  type ReviewNotificationEventToggles
} from '../../shared/review-notification-types'
import { listGitLabReviewItems } from './gitlab-source'
import { listGitHubReviewItems } from './github-source'
import { advanceWatermark, watermarkKey, type ReviewWatermarkStore } from './dedup'
import { classifyReviewItems } from './review-classify'
import { ReviewNotificationBudget, type ReviewBudgetDelivery } from './review-budget'
import type { ReviewEvent, ReviewPollItem } from './review-event'
import type { ItemSnapshot } from './transitions'

export type ReviewPollerRepo = Pick<Repo, 'id' | 'displayName' | 'reviewNotifications'>

export type ReviewPollerDeps = {
  getRepos: () => ReviewPollerRepo[]
  getGlobalEnabled: () => boolean
  store: ReviewWatermarkStore
  delivery: ReviewBudgetDelivery
  now?: () => number
  random?: () => number
  onHealth?: (repoId: string, provider: 'gitlab' | 'github', error: string | null) => void
  gitlabList?: typeof listGitLabReviewItems
  githubList?: typeof listGitHubReviewItems
  setTimeoutFn?: (callback: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

export type ReviewPollSourceError = {
  kind: 'auth' | 'rate_limited' | 'network' | 'parse'
  retryAfterMs?: number
  message: string
}

function isSourceError(error: unknown): error is ReviewPollSourceError {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  return 'kind' in error && 'message' in error && typeof error.message === 'string'
}

type ProviderJob = {
  repoId: string
  repoLabel: string
  provider: 'gitlab' | 'github'
  config: ReviewNotificationConfig
  timer: unknown
  consecutiveFailures: number
  budget: ReviewNotificationBudget
  /** Last-seen snapshots for transition classification (session-local). */
  snapshots: Map<string, ItemSnapshot>
}

const MAX_BACKOFF_MULTIPLIER = 4

export class ReviewNotificationPoller {
  private jobs = new Map<string, ProviderJob>()
  private stopped = false
  private deps: Required<
    Pick<
      ReviewPollerDeps,
      'now' | 'random' | 'gitlabList' | 'githubList' | 'setTimeoutFn' | 'clearTimeoutFn'
    >
  > &
    ReviewPollerDeps

  constructor(deps: ReviewPollerDeps) {
    this.deps = {
      now: () => Date.now(),
      random: Math.random,
      gitlabList: listGitLabReviewItems,
      githubList: listGitHubReviewItems,
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
      ...deps
    }
  }

  start(): void {
    this.stopped = false
    this.reconcile()
  }

  stop(): void {
    this.stopped = true
    for (const job of this.jobs.values()) {
      if (job.timer) {
        this.deps.clearTimeoutFn(job.timer)
      }
      job.timer = null
    }
    this.jobs.clear()
  }

  /** Rebuild the job set from current repo configs (call on settings change). */
  reconcile(): void {
    const globalEnabled = this.deps.getGlobalEnabled()
    const seen = new Set<string>()
    for (const repo of this.deps.getRepos()) {
      const config = resolveReviewNotificationConfig(repo.reviewNotifications)
      if (!isReviewNotificationPollingEnabled(config, globalEnabled)) {
        continue
      }
      for (const provider of ['gitlab', 'github'] as const) {
        const providerConfig = config.providers[provider]
        if (!providerConfig?.enabled) {
          continue
        }
        const key = `${repo.id}|${provider}`
        seen.add(key)
        let job = this.jobs.get(key)
        if (!job) {
          job = {
            repoId: repo.id,
            repoLabel: repo.displayName || repo.id,
            provider,
            config,
            timer: null,
            consecutiveFailures: 0,
            budget: new ReviewNotificationBudget(this.deps.now),
            snapshots: new Map()
          }
          this.jobs.set(key, job)
          this.schedule(job, this.jitteredInterval(job))
        } else {
          job.config = config
          job.repoLabel = repo.displayName || repo.id
        }
      }
    }
    for (const key of this.jobs.keys()) {
      if (!seen.has(key)) {
        const job = this.jobs.get(key)
        if (job?.timer) {
          this.deps.clearTimeoutFn(job.timer)
        }
        this.jobs.delete(key)
      }
    }
  }

  /** Single poll for one repo+provider; used by tests and manual refresh. */
  async pollOnce(repoId: string, provider: 'gitlab' | 'github'): Promise<ReviewPollItem[]> {
    const job = this.jobs.get(`${repoId}|${provider}`)
    if (!job) {
      return []
    }
    return this.pollJob(job)
  }

  private jitteredInterval(job: ProviderJob): number {
    const base = job.config.pollIntervalMinutes * 60 * 1000
    const jitter = 1 + (this.deps.random() * 0.4 - 0.2)
    return Math.max(60 * 1000, Math.round(base * jitter))
  }

  private schedule(job: ProviderJob, delayMs: number): void {
    if (this.stopped) {
      return
    }
    if (job.timer) {
      this.deps.clearTimeoutFn(job.timer)
    }
    job.timer = this.deps.setTimeoutFn(() => {
      void this.pollJob(job)
        .catch(() => {})
        .finally(() => {
          if (!this.stopped) {
            this.schedule(job, this.nextDelay(job))
          }
        })
    }, delayMs)
  }

  private nextDelay(job: ProviderJob): number {
    const base = this.jitteredInterval(job)
    if (job.consecutiveFailures === 0) {
      return base
    }
    const multiplier = Math.min(2 ** job.consecutiveFailures, MAX_BACKOFF_MULTIPLIER)
    return base * multiplier
  }

  private hostOf(job: ProviderJob): string {
    if (job.provider === 'gitlab') {
      try {
        return new URL(job.config.providers.gitlab?.baseUrl ?? '').hostname
      } catch {
        return 'gitlab'
      }
    }
    return 'github.com'
  }

  private repoSlugOf(job: ProviderJob): string {
    if (job.provider === 'gitlab') {
      return `projects/${job.config.providers.gitlab?.projectId ?? 0}`
    }
    const gh = job.config.providers.github
    return `${gh?.owner ?? ''}/${gh?.repo ?? ''}`
  }

  private async pollJob(job: ProviderJob): Promise<ReviewPollItem[]> {
    const host = this.hostOf(job)
    const slug = this.repoSlugOf(job)
    const since =
      this.deps.store.getWatermark(watermarkKey(job.provider, host, slug, 'mr')) ??
      new Date(this.deps.now() - job.config.pollIntervalMinutes * 60 * 1000).toISOString()
    let listed: { mrs: ReviewEvent[]; issues: ReviewEvent[] }
    let events: ReviewNotificationEventToggles
    let watchedLabels: string[]
    try {
      if (job.provider === 'gitlab') {
        const provider = job.config.providers.gitlab
        if (!provider?.enabled) {
          return []
        }
        events = provider.events
        watchedLabels = provider.watchedLabels ?? []
        listed = await this.deps.gitlabList(provider, since)
      } else {
        const provider = job.config.providers.github
        if (!provider?.enabled) {
          return []
        }
        events = provider.events
        watchedLabels = provider.watchedLabels ?? []
        listed = await this.deps.githubList(provider, since)
      }
    } catch (error) {
      this.onSourceError(
        job,
        isSourceError(error) ? error : { kind: 'network', message: String(error) }
      )
      return []
    }
    job.consecutiveFailures = 0
    this.deps.onHealth?.(job.repoId, job.provider, null)

    const items = classifyReviewItems(
      { snapshots: job.snapshots, store: this.deps.store, now: this.deps.now },
      { provider: job.provider, events, watchedLabels, listed }
    )
    const delivered = await job.budget.apply({
      repoLabel: job.repoLabel,
      items,
      maxPerHour: job.config.maxNotificationsPerHour,
      digest: job.config.digest,
      delivery: this.deps.delivery
    })

    const maxUpdated = [...listed.mrs, ...listed.issues]
      .map((e) => e.updatedAt)
      .filter(Boolean)
      .sort()
      .pop()
    const nowIso = new Date(this.deps.now()).toISOString()
    advanceWatermark(
      this.deps.store,
      watermarkKey(job.provider, host, slug, 'mr'),
      maxUpdated && maxUpdated > since ? maxUpdated : nowIso
    )
    advanceWatermark(this.deps.store, watermarkKey(job.provider, host, slug, 'issue'), nowIso)
    await this.deps.store.flush()
    return delivered
  }

  private onSourceError(job: ProviderJob, error: ReviewPollSourceError): void {
    job.consecutiveFailures += 1
    // Never notify on poller failures; surface as a quiet health badge only.
    this.deps.onHealth?.(job.repoId, job.provider, error.message)
    if (error.kind === 'rate_limited' && error.retryAfterMs) {
      if (job.timer) {
        this.deps.clearTimeoutFn(job.timer)
      }
      job.timer = this.deps.setTimeoutFn(
        () => {
          if (!this.stopped) {
            this.schedule(job, this.nextDelay(job))
          }
          void this.pollJob(job).catch(() => {})
        },
        Math.min(error.retryAfterMs, 15 * 60 * 1000)
      )
    }
  }
}
