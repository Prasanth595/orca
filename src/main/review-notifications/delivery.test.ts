import { describe, expect, it, vi } from 'vitest'
import { createReviewDelivery } from './delivery'
import type { ReviewEvent } from './review-event'

const event: ReviewEvent = {
  provider: 'gitlab',
  host: 'gitlab.example.com',
  repo: 'gitlab.example.com/projects/42',
  kind: 'mr',
  action: 'opened',
  iid: 7,
  actor: 'alice',
  title: 'Add search',
  url: 'https://gitlab.example.com/-/merge_requests/7',
  updatedAt: '2026-10-19T10:00:00Z'
}

type FakeNotification = {
  show: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  handlers: Record<string, ((...args: never[]) => void)[]>
}

function makeFakeNotification(): FakeNotification {
  const handlers: Record<string, ((...args: never[]) => void)[]> = {}
  return {
    show: vi.fn(),
    close: vi.fn(),
    on: vi.fn((name: string, cb: (...args: never[]) => void) => {
      ;(handlers[name] ??= []).push(cb)
    }),
    handlers
  }
}

describe('delivery', () => {
  it('shows a notification with a Summarize action and click-to-open', async () => {
    const created: FakeNotification[] = []
    const onSummarize = vi.fn()
    const openUrl = vi.fn(async () => {})
    const delivery = createReviewDelivery({
      onSummarize,
      openUrl,
      createNotification: ((options: Electron.NotificationConstructorOptions) => {
        const fake = makeFakeNotification()
        ;(fake as unknown as { options: unknown }).options = options
        created.push(fake)
        return fake as unknown as Electron.Notification
      }) as never
    })
    await delivery.deliver([{ event, disposition: 'notify' }])
    expect(created).toHaveLength(1)
    expect(created[0].show).toHaveBeenCalled()
    const options = (created[0] as unknown as { options: Electron.NotificationConstructorOptions })
      .options
    expect(options.title).toMatch(/merge request/)
    expect(options.actions).toEqual([{ type: 'button', text: 'Summarize' }])

    // Click opens the URL; the action button triggers Summarize.
    created[0].handlers['click']?.[0]()
    expect(openUrl).toHaveBeenCalledWith(event.url)
    created[0].handlers['action']?.[0]({}, 0)
    expect(onSummarize).toHaveBeenCalledWith(event)
  })

  it('resolve closes the active notification without showing a new one', async () => {
    const created: FakeNotification[] = []
    const delivery = createReviewDelivery({
      onSummarize: () => {},
      createNotification: (() => {
        const fake = makeFakeNotification()
        created.push(fake)
        return fake as unknown as Electron.Notification
      }) as never
    })
    await delivery.deliver([{ event, disposition: 'notify' }])
    expect(created).toHaveLength(1)
    await delivery.deliver([{ event: { ...event, action: 'closed' }, disposition: 'resolve' }])
    expect(created).toHaveLength(1)
    expect(created[0].close).toHaveBeenCalled()
  })

  it('delivers a digest as a single notification', async () => {
    const created: FakeNotification[] = []
    const delivery = createReviewDelivery({
      onSummarize: () => {},
      createNotification: ((options: Electron.NotificationConstructorOptions) => {
        const fake = makeFakeNotification()
        ;(fake as unknown as { options: unknown }).options = options
        created.push(fake)
        return fake as unknown as Electron.Notification
      }) as never
    })
    await delivery.deliverDigest('proj', [event, { ...event, iid: 8, title: 'Other' }])
    expect(created).toHaveLength(1)
    const options = (created[0] as unknown as { options: Electron.NotificationConstructorOptions })
      .options
    expect(options.title).toMatch(/2 new review items/)
  })
})
