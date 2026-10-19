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
  setClosed: (mrs: ReviewEvent[], issues?: ReviewEvent[]) => void
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
  let closed: { mrs: ReviewEvent[]; issues: ReviewEvent[] } = { mrs: [], issues: [] }
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
    gitlabListClosed: async () => {
      if (throwError) {
        throw throwError
      }
      return closed
    },
    githubListClosed: async () => ({ mrs: [], issues: [] }),
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
    setClosed: (mrs, issues = []) => {
      closed = { mrs, issues }
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
        gitlabListClosed: async () => ({ mrs: [], issues: [] }),
        githubListClosed: async () => ({ mrs: [], issues: [] }),
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

  it('does NOT resolve an MR merely absent from the delta listing', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setListed([mrEvent()])
    await h.poller.pollOnce('r1', 'gitlab')
    expect(h.delivered.flat().filter((i) => i.disposition === 'notify')).toHaveLength(1)

    // The delta listing omits unchanged items: no resolve, no re-notify.
    h.setListed([])
    h.setClosed([])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(0)

    // A later push on the same MR is an update, not a new "opened".
    h.setListed([mrEvent({ updatedAt: '2026-10-19T10:05:00Z' })])
    h.setClosed([])
    const items2 = await h.poller.pollOnce('r1', 'gitlab')
    expect(items2.filter((i) => i.disposition === 'notify')).toHaveLength(0)
  })

  it('resolves silently when the closed listing confirms the MR is gone', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setListed([mrEvent()])
    await h.poller.pollOnce('r1', 'gitlab')
    expect(h.delivered).toHaveLength(1)

    h.setListed([])
    h.setClosed([mrEvent({ updatedAt: '2026-10-19T10:30:00Z' })])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(1)
    expect(items[0].disposition).toBe('resolve')
    // The resolve is delivered but never as a user-facing notification.
    expect(items[0].event.action).toBe('closed')
  })

  it('ignores closed-listing entries for items never seen (no snapshot)', async () => {
    const h = makeHarness([{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }])
    h.setListed([])
    h.setClosed([mrEvent({ updatedAt: '2026-10-19T10:30:00Z' })])
    const items = await h.poller.pollOnce('r1', 'gitlab')
    expect(items).toHaveLength(0)
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

describe('poller orphan jobs', () => {
  function makeTimerHarness(
    repos: () => {
      id: string
      displayName: string
      reviewNotifications?: ReviewNotificationConfig
    }[],
    gitlabList: () => Promise<{ mrs: ReviewEvent[]; issues: ReviewEvent[] }>
  ) {
    const timers = new Map<number, () => void>()
    let nextId = 1
    let pollCalls = 0
    const delivered: ReviewPollItem[][] = []
    const store = createInMemoryWatermarkStore()
    const poller = new ReviewNotificationPoller({
      getRepos: repos,
      getGlobalEnabled: () => true,
      store,
      delivery: {
        deliver: async (items) => {
          delivered.push(items)
        },
        deliverDigest: async () => {}
      },
      now: () => Date.now(),
      random: () => 0.5,
      gitlabList: async () => {
        pollCalls += 1
        return gitlabList()
      },
      githubList: async () => ({ mrs: [], issues: [] }),
      gitlabListClosed: async () => ({ mrs: [], issues: [] }),
      githubListClosed: async () => ({ mrs: [], issues: [] }),
      setTimeoutFn: (cb: () => void) => {
        const id = nextId++
        timers.set(id, cb)
        return id
      },
      clearTimeoutFn: (id: unknown) => {
        if (typeof id === 'number') {
          timers.delete(id)
        }
      }
    })
    const fireTimer = (id: number) => {
      const cb = timers.get(id)
      expect(cb).toBeDefined()
      cb!()
    }
    return { poller, timers, delivered, fireTimer, pollCalls: () => pollCalls }
  }

  it('does not reschedule a job removed while its poll is in flight', async () => {
    let repos = [{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }]
    let releasePoll!: () => void
    const h = makeTimerHarness(
      () => repos,
      () =>
        new Promise<{ mrs: ReviewEvent[]; issues: ReviewEvent[] }>((r) => {
          releasePoll = () => r({ mrs: [], issues: [] })
        })
    )
    h.poller.start()
    expect(h.timers.size).toBe(1)
    const timerId = [...h.timers.keys()][0]!
    h.fireTimer(timerId)
    // Let the poll reach the hanging source call.
    await new Promise((r) => setImmediate(r))
    expect(h.pollCalls()).toBe(1)
    // Disable the repo mid-poll: the job is removed and its timer cleared.
    repos = []
    h.poller.reconcile()
    // Finish the poll: the finally must not resurrect the removed job.
    releasePoll()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.timers.size).toBe(0)
    expect(h.delivered).toHaveLength(0)
    h.poller.stop()
  })

  it('does not poll or reschedule from a stale retry timer after removal', async () => {
    let repos = [{ id: 'r1', displayName: 'proj', reviewNotifications: gitlabConfig() }]
    const h = makeTimerHarness(
      () => repos,
      async () => {
        throw {
          kind: 'rate_limited',
          retryAfterMs: 60_000,
          message: 'GitLab rate limit hit (429).'
        }
      }
    )
    h.poller.start()
    expect(h.timers.size).toBe(1)
    const firstTimer = [...h.timers.keys()][0]!
    h.fireTimer(firstTimer)
    // Let the poll fail and arm the backoff retry timer.
    await new Promise((r) => setTimeout(r, 20))
    expect(h.pollCalls()).toBe(1)
    expect(h.timers.size).toBe(1)
    const retryTimer = [...h.timers.keys()][0]!
    const retryCb = h.timers.get(retryTimer)!
    // Remove the job while the backoff is pending.
    repos = []
    h.poller.reconcile()
    expect(h.timers.size).toBe(0)
    // The stale retry callback must neither poll nor reschedule.
    retryCb()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.pollCalls()).toBe(1)
    expect(h.timers.size).toBe(0)
    h.poller.stop()
  })
})

describe('poller listing cursors', () => {
  // Sources simulate forge pagination: items with updatedAt > since, oldest
  // 50 first (sort=asc, per_page=50, no further pages followed).
  function pagedHarness() {
    const nowRef = { now: new Date('2026-10-19T12:00:00Z').getTime() }
    const store = createInMemoryWatermarkStore()
    let openItems: ReviewEvent[] = []
    let closedItems: ReviewEvent[] = []
    const pageOf = (items: ReviewEvent[], since: string) =>
      items
        .filter((e) => e.updatedAt > since)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0))
        .slice(0, 50)
    const poller = new ReviewNotificationPoller({
      getRepos: () => [
        {
          id: 'r1',
          displayName: 'proj',
          reviewNotifications: gitlabConfig({
            pollIntervalMinutes: 60,
            maxNotificationsPerHour: 1000
          })
        }
      ],
      getGlobalEnabled: () => true,
      store,
      delivery: { deliver: async () => {}, deliverDigest: async () => {} },
      now: () => nowRef.now,
      random: () => 0.5,
      gitlabList: async (_provider, since) => ({ mrs: pageOf(openItems, since), issues: [] }),
      githubList: async () => ({ mrs: [], issues: [] }),
      gitlabListClosed: async (_provider, since) => ({
        mrs: pageOf(closedItems, since),
        issues: []
      }),
      githubListClosed: async () => ({ mrs: [], issues: [] }),
      setTimeoutFn: () => ({}),
      clearTimeoutFn: () => {}
    })
    poller.reconcile()
    return {
      poller,
      nowRef,
      setOpen: (items: ReviewEvent[]) => {
        openItems = items
      },
      setClosed: (items: ReviewEvent[]) => {
        closedItems = items
      }
    }
  }

  // Minutes after 2026-10-19T11:00:00Z.
  const at = (mins: number) =>
    new Date(new Date('2026-10-19T11:00:00Z').getTime() + mins * 60000).toISOString()
  const openMr = (iid: number, mins: number): ReviewEvent =>
    mrEvent({ iid, action: 'opened', updatedAt: at(mins), title: `MR ${iid}` })
  const closedMr = (iid: number, mins: number): ReviewEvent =>
    mrEvent({ iid, action: 'closed', updatedAt: at(mins), title: `MR ${iid}` })

  it('resolves every closed item across polls when the closed listing exceeds per_page', async () => {
    const h = pagedHarness()
    // Polls 1-2: 60 open MRs, all notified (the open listing itself pages).
    h.setOpen(Array.from({ length: 60 }, (_, i) => openMr(i + 1, i + 1)))
    h.setClosed([])
    await h.poller.pollOnce('r1', 'gitlab')
    await h.poller.pollOnce('r1', 'gitlab')

    // Poll 2: all 60 now closed, plus a newer open MR. The closed listing
    // returns only the oldest 50 (per_page); the open item is newer.
    h.nowRef.now = new Date('2026-10-19T12:10:00Z').getTime()
    h.setOpen([openMr(61, 91)])
    h.setClosed(Array.from({ length: 60 }, (_, i) => closedMr(i + 1, 60 + (i + 1) * 0.5)))
    const second = await h.poller.pollOnce('r1', 'gitlab')
    expect(second.filter((i) => i.disposition === 'resolve')).toHaveLength(50)

    // Poll 3: the remaining 10 closed items must still resolve. With a shared
    // cursor the newer open item would have advanced the watermark past them.
    h.nowRef.now = new Date('2026-10-19T12:20:00Z').getTime()
    const third = await h.poller.pollOnce('r1', 'gitlab')
    const resolved = [...second, ...third]
      .filter((i) => i.disposition === 'resolve')
      .map((i) => i.event.iid)
      .sort((a, b) => a - b)
    expect(resolved).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
  })

  it('does not miss open items when a newer closed item exists', async () => {
    const h = pagedHarness()
    // Polls 1-2: 60 open MRs, all notified (the open listing itself pages).
    h.setOpen(Array.from({ length: 60 }, (_, i) => openMr(i + 1, i + 1)))
    h.setClosed([])
    await h.poller.pollOnce('r1', 'gitlab')
    await h.poller.pollOnce('r1', 'gitlab')

    // Poll 2: 60 new open MRs plus one closed item newer than all of them.
    // The open listing returns only the oldest 50 (per_page).
    h.nowRef.now = new Date('2026-10-19T12:10:00Z').getTime()
    h.setOpen(Array.from({ length: 60 }, (_, i) => openMr(101 + i, 60 + (i + 1) * 0.5)))
    h.setClosed([closedMr(1, 91)])
    const second = await h.poller.pollOnce('r1', 'gitlab')
    expect(second.filter((i) => i.disposition === 'notify')).toHaveLength(50)
    expect(second.filter((i) => i.disposition === 'resolve')).toHaveLength(1)

    // Poll 3: the remaining 10 open MRs must still notify. With a shared
    // cursor the newer closed item would have advanced the watermark past them.
    h.nowRef.now = new Date('2026-10-19T12:20:00Z').getTime()
    const third = await h.poller.pollOnce('r1', 'gitlab')
    const notified = [...second, ...third]
      .filter((i) => i.disposition === 'notify')
      .map((i) => i.event.iid)
      .sort((a, b) => a - b)
    expect(notified).toEqual(Array.from({ length: 60 }, (_, i) => 101 + i))
  })
})
