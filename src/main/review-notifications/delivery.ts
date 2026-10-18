import { Notification, shell } from 'electron'
import { describeReviewEvent, type ReviewEvent, type ReviewPollItem } from './review-event'
import type { ReviewBudgetDelivery } from './review-budget'

export type ReviewDeliveryDeps = {
  /** Called when the user clicks "Summarize" on a notification. */
  onSummarize: (event: ReviewEvent) => void
  /** Optional push-parity dispatch (e.g. mobile push via the notification controller). */
  dispatchPush?: (event: ReviewEvent) => void
  createNotification?: (options: Electron.NotificationConstructorOptions) => Electron.Notification
  openUrl?: (url: string) => Promise<void>
}

function notificationKey(event: ReviewEvent): string {
  return [
    event.provider,
    event.host.toLowerCase(),
    event.repo.toLowerCase(),
    event.kind,
    event.iid
  ].join('|')
}

function bodyFor(event: ReviewEvent): string {
  const actor = event.actor ? ` by ${event.actor}` : ''
  return `${event.title}${actor}`
}

/**
 * Desktop delivery for review notifications. Update/resolve are keyed per
 * (provider, host, repo, kind, iid) so a push only ever refreshes or
 * dismisses its own notification — existing notification behavior elsewhere
 * is untouched.
 */
export function createReviewDelivery(deps: ReviewDeliveryDeps): ReviewBudgetDelivery {
  const active = new Map<string, Electron.Notification>()
  const createNotification = deps.createNotification ?? ((options) => new Notification(options))
  const openUrl = deps.openUrl ?? ((url) => shell.openExternal(url))

  const showNew = (event: ReviewEvent) => {
    const key = notificationKey(event)
    active.get(key)?.close()
    const notification = createNotification({
      title: describeReviewEvent(event),
      body: bodyFor(event),
      actions: [{ type: 'button', text: 'Summarize' }]
    })
    notification.on('click', () => {
      if (event.url) {
        void openUrl(event.url)
      }
    })
    notification.on('action', (_e, index) => {
      if (index === 0) {
        deps.onSummarize(event)
      }
    })
    notification.on('close', () => {
      if (active.get(key) === notification) {
        active.delete(key)
      }
    })
    active.set(key, notification)
    notification.show()
    deps.dispatchPush?.(event)
  }

  return {
    deliver: async (items: ReviewPollItem[]) => {
      for (const item of items) {
        const key = notificationKey(item.event)
        if (item.disposition === 'resolve') {
          active.get(key)?.close()
          active.delete(key)
          continue
        }
        if (item.disposition === 'update') {
          const existing = active.get(key)
          if (existing) {
            existing.close()
            active.delete(key)
          }
          // Re-show as a quiet refresh of the same notification.
          showNew(item.event)
          continue
        }
        showNew(item.event)
      }
    },
    deliverDigest: async (repoLabel: string, events: ReviewEvent[]) => {
      const notification = createNotification({
        title: `${events.length} new review items in ${repoLabel}`,
        body: events
          .slice(0, 5)
          .map((e) => `• ${describeReviewEvent(e)}: ${e.title}`)
          .join('\n')
      })
      notification.on('click', () => {
        const first = events.find((e) => e.url)
        if (first?.url) {
          void openUrl(first.url)
        }
      })
      notification.show()
    }
  }
}
