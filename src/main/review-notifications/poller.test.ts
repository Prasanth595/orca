import { describe, expect, it } from 'vitest'
import { ReviewNotificationPoller, type ReviewPollItem } from './poller'
import { createInMemoryWatermarkStore } from './dedup'
import type { ReviewEvent } from './review-event'
import {
  resolveReviewNotificationConfig,
  resolveReviewNotificationEvents,
  type ReviewNotificationConfig
} from '../../shared/review-notification-types'

function gitlabConfig(overrides: Partial<ReviewNotificationConfig> = {}): ReviewNotificationConfig {
  return resolveReviewNotificationConfig({
    enabled: true,
    providers: {
      gitlab: {
        kind: 'gitlab',
        enabled: true,
        baseUrl: 'https://gitlab.example.com',
        projectId: 42,
        events: resolveReviewNotificationEvents(undefined)
      }
    },
    ...overrides
  })
}

function mrEvent(overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return {
    provider: 'gitlab',
    host: 'gitlab.example.com',
    repo: 'gitlab.example.com/projects/42',
    kind: 'mr',
    action: 'opened',
    iid: 7,
    actor: 'alice',
    title: 'Add search',
    url: 'https://gitlab.example.com/-/merge_requests/7',
    updatedAt: '2026-10-19T10:00:00Z',
    ...overrides
  }
}

type Harness = {
  poller: ReviewNotificationPoller
  delivered: ReviewPollItem[][]
  digests: { repoLabel: string; events: ReviewEvent[] }[]
  health: { repoId: string; provider: string; error: string | null }[]
  setListed: (mrs: ReviewEvent[], issues?: ReviewEvent[]) => void
  setThrow: (error: unknown) => void
}

function makeHarness(
  repos: { id: string; displayName: string; reviewNotifications?: ReviewNotificationConfig }[],
  opts: { globalEnabled?: boolean; maxPerHour?: number } = {}
): Harness {
  const delivered: ReviewPollItem[][] = []
  const digests: { repoLabel: string; events: ReviewEvent[] }[] = []
  const health: { repoId: string; provider: string; error: string | null }[] = []
  let listed: { mrs: ReviewEvent[]; issues: ReviewEvent[] } = { mrs: [], issues: [] }
  let throwError: unknown = null
  const store = createInMemoryWatermarkStore()
  const poller = new ReviewNotificationPoller({
    getRepos: () => repos,
    getGlobalEnabled: () => opts.globalEnabled !== false,
    store,
    delivery: {
      deliver: async (items) => {
        delivered.push(items)
      },
      deliverDigest: async (repoLabel, events) => {
        digests.push({ repoLabel, events })
      }
    },
    now: () => new Date('2026-10-19T12:00:00Z').getTime(),
    random: () => 0.5,
    onHealth: (repoId, provider, error) => {
      health.push({ repoId, provider, error })
    },
    gitlabList: async () => {
      if (throwError) {
        throw throwError
      }
      return listed
    },
    githubList: async () => ({ mrs: [], issues: [] }),
    setTimeoutFn: () => ({}),
    clearTimeoutFn: () => {}
  })
  poller.reconcile()
  return {
    poller,
    delivered,
    digests,
    health,
    setListed: (mrs, issues = []) => {
      listed = { mrs, issues }
      throwError = null
    },
    setThrow: (error) => {
      throwError = error
    }
  }
}

describe('poller', () => {
  it('notifies on a new MR, then stays silent on push updates', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setListed([mrEvent()])
    const first = await h.poller.pollOnce('r1', 'gitlab')
    expect(first).toHaveLength(1)
    expect(first[0].disposition).toBe('notify')
    expect(first[0].event.action).toBe('opened')
    expect(h.delivered).toHaveLength(1)

    // Same MR with a newer updatedAt (a push): no new notification by default.
    h.setListed([mrEvent({ updatedAt: '2026-10-19T10:05:00Z' })])
    const second = await h.poller.pollOnce('r1', 'gitlab')
    expect(second).toHaveLength(0)
  })

  it('does not re-notify after a restart (fingerprints persist)', async () => {
    const store = createInMemoryWatermarkStore()
    const repos = [{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }]
    const mk = () =>
      new ReviewNotificationPoller({
        getRepos: () => repos,
        getGlobalEnabled: () => true,
        store,
        delivery: { deliver: async () => {}, deliverDigest: async () => {} },
        now: () => new Date('2026-10-19T12:00:00Z').getTime(),
        random: () => 0.5,
        gitlabList: async () => ({ mrs: [mrEvent()], issues: [] }),
        githubList: async () => ({ mrs: [], issues: [] }),
        setTimeoutFn: () => ({}),
        clearTimeoutFn: () => {}
      })
    const first = mk()
    first.reconcile()
    const delivered1: ReviewPollItem[] = []
    // pollOnce uses the harness delivery; emulate by checking returned items.
    const items1 = await first.pollOnce('r1', 'gitlab')
    delivered1.push(...items1)
    expect(delivered1).toHaveLength(1)

    // "Restart": brand-new poller, same persisted store.
    const second = mk()
    second.reconcile()
    const items2 = await second.pollOnce('r1', 'gitlab')
    expect(items2).toHaveLength(0)
  })

  it('backs off quietly on 429 and records health without notifying', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setThrow({ kind: 'rate_limited', message: 'GitLab rate limit hit (429).' })
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(0)
    expect(h.delivered).toHaveLength(0)
    expect(h.health.some((x) => x.error !== null)).toBe(true)
  })

  it('resolves silently when the MR disappears (merged/closed)', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setListed([mrEvent()])
    await h.poller.pollOnce('r1', 'gitlab')
    expect(h.delivered).toHaveLength(1)

    h.setListed([])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(1)
    expect(items[0].disposition).toBe('resolve')
    // The resolve is delivered but never as a user-facing notification.
    expect(items[0].event.action).toBe('closed')
  })

  it('groups overflow into a digest past the hourly budget', async () => {
    const h = makeHarness([
      {
        id: 'r1',
        displayName: 'proj',
        reviewNotifications: gitlabConfig({ maxNotificationsPerHour: 1 })
      }
    ])
    h.setListed([mrEvent({ iid: 7 }), mrEvent({ iid: 8, title: 'Other' })])
    await h.poller.pollOnce('r1', 'gitlab')
    const notifies = h.delivered.flat().filter((i) => i.disposition === 'notify')
    expect(notifies).toHaveLength(1)
    expect(h.digests).toHaveLength(1)
    expect(h.digests[0].events).toHaveLength(1)
    expect(h.digests[0].events[0].iid).toBe(8)
  })

  it('regression: absent config means zero behavior change', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj' }])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(0)
    expect(h.delivered).toHaveLength(0)
    expect(h.digests).toHaveLength(0)
    // No jobs were scheduled either.
    h.poller.stop()
  })

  it('regression: global kill-switch disables polling', async () => {
    const h = makeHarness(
      [{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }],
      {
        globalEnabled: false
      }
    )
    h.setListed([mrEvent()])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(0)
  })

  it('notifies on watched-label transitions', async () => {
    const config = gitlabConfig()
    config.providers.gitlab!.watchedLabels = ['urgent']
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: config }])
    h.setListed([mrEvent({ meta: { labels: [] } })])
    await h.poller.pollOnce('r1', 'gitlab')
    expect(h.delivered.flat().filter((i) => i.disposition === 'notify')).toHaveLength(1)

    // A watched label lands: new notification with the labeled action.
    h.setListed([mrEvent({ meta: { labels: ['urgent'] }, updatedAt: '2026-10-19T10:05:00Z' })])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    const notifies = items.filter((i) => i.disposition === 'notify')
    expect(notifies).toHaveLength(1)
    expect(notifies[0].event.action).toBe('labeled')

    // An unwatched label: silent.
    h.setListed([
      mrEvent({ meta: { labels: ['urgent', 'docs'] }, updatedAt: '2026-10-19T10:06:00Z' })
    ])
    const items2 = await h.poller.pollOnce('r1', 'gitlab')
    expect(items2.filter((i) => i.disposition === 'notify')).toHaveLength(0)
  })
})

describe('poller draft transition', () => {
  it('notifies when a draft MR becomes ready for review', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setListed([mrEvent({ meta: { draft: true } })])
    await h.poller.pollOnce('r1', 'gitlab')
    expect(h.delivered.flat().filter((i) => i.disposition === 'notify')).toHaveLength(1)

    h.setListed([mrEvent({ meta: { draft: false }, updatedAt: '2026-10-19T10:05:00Z' })])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    const notifies = items.filter((i) => i.disposition === 'notify')
    expect(notifies).toHaveLength(1)
    expect(notifies[0].event.action).toBe('ready_for_review')
  })
})
