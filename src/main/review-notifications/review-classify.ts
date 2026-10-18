import type { ReviewNotificationEventToggles } from '../../shared/review-notification-types'
import type { ReviewWatermarkStore } from './dedup'
import { fingerprintReviewEvent, type ReviewEvent, type ReviewPollItem } from './review-event'
import {
  applyTransition,
  classifyTransition,
  type ItemSnapshot,
  type Transition
} from './transitions'

export type ReviewClassifyDeps = {
  snapshots: Map<string, ItemSnapshot>
  store: ReviewWatermarkStore
  now: () => number
}

export type ReviewClassifyInput = {
  provider: 'gitlab' | 'github'
  events: ReviewNotificationEventToggles
  watchedLabels: string[]
  listed: { mrs: ReviewEvent[]; issues: ReviewEvent[] }
}

function snapshotKey(event: ReviewEvent): string {
  return [
    event.provider,
    event.host.toLowerCase(),
    event.repo.toLowerCase(),
    event.kind,
    event.iid
  ].join('|')
}

function updatedToggleOn(kind: 'mr' | 'issue', events: ReviewNotificationEventToggles): boolean {
  return kind === 'mr' ? events.mrUpdated : events.issueUpdated
}

/**
 * Diff a poll snapshot against last-seen state, producing notify/update/
 * resolve items. Fingerprint dedup runs here so a restart never re-notifies.
 */
export function classifyReviewItems(
  deps: ReviewClassifyDeps,
  input: ReviewClassifyInput
): ReviewPollItem[] {
  const { snapshots, store, now } = deps
  const { provider, events, watchedLabels, listed } = input
  const out: ReviewPollItem[] = []
  const seenKeys = new Set<string>()
  const handle = (event: ReviewEvent): void => {
    const key = snapshotKey(event)
    seenKeys.add(key)
    const prev = snapshots.get(key)
    const snapshot: ItemSnapshot = {
      iid: event.iid,
      updatedAt: event.updatedAt,
      draft: event.meta?.draft ?? prev?.draft ?? false,
      reviewers: event.meta?.reviewers ?? prev?.reviewers ?? [],
      labels: event.meta?.labels ?? prev?.labels ?? [],
      title: event.title
    }
    const transition: Transition = classifyTransition(prev, snapshot, watchedLabels)
    snapshots.set(key, snapshot)
    const classified = applyTransition(event, transition, event.kind, events)
    if (!classified) {
      // 'updated' refreshes in place when its toggle is on; silent otherwise.
      if (transition.action === 'updated' && updatedToggleOn(event.kind, events)) {
        out.push({ event: { ...event, action: 'updated' }, disposition: 'update' })
      }
      return
    }
    const fp = fingerprintReviewEvent(classified)
    if (store.hasFingerprint(fp)) {
      return
    }
    store.addFingerprint(fp)
    out.push({
      event: classified,
      disposition: classified.action === 'updated' ? 'update' : 'notify'
    })
  }
  for (const e of listed.mrs) {
    handle(e)
  }
  for (const e of listed.issues) {
    handle(e)
  }
  // Items that vanished from the open list: resolve their notification silently.
  for (const [key, snap] of snapshots) {
    if (seenKeys.has(key)) {
      continue
    }
    const [itemProvider, host, repo, kind, iid] = key.split('|')
    if (itemProvider !== provider) {
      continue
    }
    out.push({
      event: {
        provider,
        host,
        repo,
        kind: kind as 'mr' | 'issue',
        action: 'closed',
        iid: Number(iid),
        actor: '',
        title: snap.title,
        url: '',
        updatedAt: new Date(now()).toISOString()
      },
      disposition: 'resolve'
    })
    snapshots.delete(key)
  }
  return out
}
