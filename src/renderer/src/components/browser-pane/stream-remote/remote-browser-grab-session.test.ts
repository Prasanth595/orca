import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RemoteGrabPoint,
  RemoteGrabQuery,
  RemoteGrabQueryResult
} from '../../../../../shared/browser-grab/remote-grab-point-script'
import {
  REMOTE_GRAB_MIN_START_INTERVAL_MS,
  RemoteGrabLatencyEstimate
} from './remote-browser-grab-pacing'
import { RemoteBrowserGrabSession } from './remote-browser-grab-session'
import type { RemoteGrabPreview, RemoteGrabSessionDeps } from './remote-browser-grab-session-types'

const viewport = { width: 1000, height: 1000 }
const context = { document: 'doc-1', viewport, scroll: { x: 0, y: 0 } }

function payloadFor(point: RemoteGrabPoint) {
  const rect = { x: point.x, y: point.y, width: 1, height: 1 }
  return {
    page: {
      sanitizedUrl: 'http://host/',
      title: '',
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      capturedAt: ''
    },
    target: {
      tagName: 'button',
      selector: `#at-${point.x}-${point.y}`,
      rectViewport: rect,
      rectPage: rect
    },
    nearbyText: [],
    ancestorPath: []
  }
}

/** A host whose answer for every point is a 1x1 element named after it. */
function answer(query: RemoteGrabQuery, document = context.document): RemoteGrabQueryResult {
  if (query.kind === 'probe') {
    return { ...context, document, status: 'ready' }
  }
  if (query.document !== document) {
    return { ...context, document, status: 'stale', reason: 'document' }
  }
  const { x, y } = query.point
  if (query.kind === 'preview') {
    return {
      ...context,
      status: 'preview',
      target: {
        tagName: 'button',
        role: null,
        text: `${x},${y}`,
        rect: { x, y, width: 1, height: 1 }
      }
    }
  }
  return { ...context, status: 'selected', payload: payloadFor(query.point) }
}

type Harness = {
  session: RemoteBrowserGrabSession
  queries: RemoteGrabQuery[]
  previews: (RemoteGrabPreview | null)[]
  ended: Error[]
  maxConcurrentPreviews: () => number
  shownText: () => string | null
}

function createHarness(
  latency: (query: RemoteGrabQuery, index: number) => number,
  overrides: Partial<RemoteGrabSessionDeps> = {}
): Harness {
  const queries: RemoteGrabQuery[] = []
  const previews: (RemoteGrabPreview | null)[] = []
  const ended: Error[] = []
  let outstandingPreviews = 0
  let maxOutstandingPreviews = 0
  const session = new RemoteBrowserGrabSession({
    run: (query) => {
      const index = queries.push(query) - 1
      if (query.kind === 'preview') {
        outstandingPreviews += 1
        maxOutstandingPreviews = Math.max(maxOutstandingPreviews, outstandingPreviews)
      }
      return new Promise((resolve) => {
        setTimeout(
          () => {
            if (query.kind === 'preview') {
              outstandingPreviews -= 1
            }
            resolve(answer(query))
          },
          latency(query, index)
        )
      })
    },
    map: (client) => ({ point: client, viewport, scroll: null }),
    onPreview: (preview) => previews.push(preview),
    onViewport: () => {},
    onEnded: (error) => ended.push(error),
    now: () => Date.now(),
    ...overrides
  })
  return {
    session,
    queries,
    previews,
    ended,
    maxConcurrentPreviews: () => maxOutstandingPreviews,
    shownText: () => previews.at(-1)?.target.text ?? null
  }
}

function previewCount(harness: Harness): number {
  return harness.queries.filter((query) => query.kind === 'preview').length
}

async function startSession(harness: Harness): Promise<void> {
  const started = harness.session.start()
  await vi.runOnlyPendingTimersAsync()
  expect(await started).toBe(true)
}

function createControlledHarness(overrides: Partial<RemoteGrabSessionDeps> = {}) {
  const requests: {
    query: RemoteGrabQuery
    resolve: (result: RemoteGrabQueryResult) => void
    reject: (error: Error) => void
  }[] = []
  const harness = createHarness(() => 0, {
    ...overrides,
    run: (query) =>
      new Promise<RemoteGrabQueryResult>((resolve, reject) => {
        requests.push({ query, resolve, reject })
        if (query.kind === 'probe') {
          resolve(answer(query))
        }
      })
  })
  const request = (kind: RemoteGrabQuery['kind']) => {
    const found = requests.find((entry) => entry.query.kind === kind)
    if (!found) {
      throw new Error(`No ${kind} request`)
    }
    return found
  }
  return { ...harness, requests, request }
}

/** 120 Hz sweep along a diagonal for the given duration; returns the resting point. */
async function sweep(harness: Harness, durationMs: number): Promise<RemoteGrabPoint> {
  let last = { x: 0, y: 0 }
  for (let elapsed = 0; elapsed < durationMs; elapsed += 8) {
    last = { x: Math.floor(elapsed / 8), y: Math.floor(elapsed / 8) }
    harness.session.hover(last)
    await vi.advanceTimersByTimeAsync(8)
  }
  return last
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('remote element selection hover pacing', () => {
  const previewsByRtt = new Map<number, number>()

  it.each([0, 50, 200, 500, 1000])(
    'keeps one preview in flight and settles on the resting point at %i ms RTT',
    async (rtt) => {
      const harness = createHarness(() => rtt)
      await startSession(harness)
      const before = previewCount(harness)
      const rest = await sweep(harness, 3000)
      const sent = previewCount(harness) - before
      previewsByRtt.set(rtt, sent)

      expect(harness.maxConcurrentPreviews()).toBe(1)
      // 360 pointer moves never become 360 requests: the 50 ms floor caps the rate at 20/s.
      expect(sent).toBeLessThanOrEqual(3000 / REMOTE_GRAB_MIN_START_INTERVAL_MS + 1)
      expect(sent).toBeLessThanOrEqual(Math.ceil(3000 / Math.max(rtt, 1)) + 1)

      // The resting point is previewed without another movement within two RTTs plus pacing.
      const deadline =
        2 * rtt + harness.session.estimate.quietPeriodMs() + 2 * REMOTE_GRAB_MIN_START_INTERVAL_MS
      await vi.advanceTimersByTimeAsync(deadline)
      expect(harness.shownText()).toBe(`${rest.x},${rest.y}`)
      // And nothing keeps polling once the pointer is still.
      const settled = previewCount(harness)
      await vi.advanceTimersByTimeAsync(5000)
      expect(previewCount(harness)).toBe(settled)
    }
  )

  it('sends fewer previews as latency grows', () => {
    const counts = [0, 50, 200, 500, 1000].map((rtt) => previewsByRtt.get(rtt) ?? 0)
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeLessThanOrEqual(counts[index - 1]!)
    }
    expect(counts[4]).toBeLessThan(counts[1]!)
  })

  it('never builds a backlog on a jittery link and still lands on the final point', async () => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const harness = createHarness(() => 50 + Math.floor(random() * 900))
    await startSession(harness)
    const rest = await sweep(harness, 4000)
    expect(harness.maxConcurrentPreviews()).toBe(1)
    expect(previewCount(harness)).toBeLessThan(4000 / REMOTE_GRAB_MIN_START_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(3000)
    expect(harness.shownText()).toBe(`${rest.x},${rest.y}`)
  })

  it('never paints an answer for an older pointer, even one still inside that element', async () => {
    const harness = createHarness(() => 300, {
      run: (query) =>
        new Promise((resolve) => {
          const result = answer(query)
          // Every point answers with one large element, so the moved pointer stays inside it.
          if (result.status === 'preview') {
            result.target.rect = { x: 0, y: 0, width: 1000, height: 1000 }
          }
          setTimeout(() => resolve(result), 300)
        })
    })
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    await vi.advanceTimersByTimeAsync(100)
    harness.session.hover({ x: 12, y: 12 })
    await vi.advanceTimersByTimeAsync(250)
    expect(harness.previews.filter((preview) => preview !== null)).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.shownText()).toBe('12,12')
  })

  it('clears the outline on the very next move', async () => {
    const harness = createHarness(() => 10)
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    await vi.advanceTimersByTimeAsync(200)
    expect(harness.shownText()).toBe('10,10')
    harness.session.hover({ x: 10, y: 11 })
    expect(harness.previews.at(-1)).toBeNull()
  })

  it('drops an answer for a point the pointer has already left', async () => {
    const harness = createHarness(() => 300)
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    await vi.advanceTimersByTimeAsync(100)
    harness.session.hover({ x: 500, y: 500 })
    await vi.advanceTimersByTimeAsync(250)
    // The answer for (10,10) arrived while the pointer was at (500,500): never painted.
    expect(harness.previews.some((preview) => preview?.target.text === '10,10')).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.shownText()).toBe('500,500')
  })

  it('retires an in-flight preview on scroll and requeries the resting pointer', async () => {
    const harness = createHarness(() => 200)
    await startSession(harness)
    harness.session.hover({ x: 40, y: 40 })
    await vi.advanceTimersByTimeAsync(50)
    harness.session.invalidateGeometry({ x: 40, y: 40 })
    await vi.advanceTimersByTimeAsync(160)
    expect(harness.previews.filter((preview) => preview !== null)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(600)
    expect(harness.shownText()).toBe('40,40')
    expect(previewCount(harness)).toBe(2)
  })

  it('adapts the quiet period up and back down as latency changes', () => {
    const estimate = new RemoteGrabLatencyEstimate()
    for (let index = 0; index < 20; index++) {
      estimate.record(50)
    }
    const fast = estimate.quietPeriodMs()
    for (let index = 0; index < 20; index++) {
      estimate.record(1000)
    }
    const slow = estimate.quietPeriodMs()
    for (let index = 0; index < 40; index++) {
      estimate.record(50)
    }
    expect(slow).toBeGreaterThan(fast)
    expect(estimate.quietPeriodMs()).toBeLessThan(slow)
    expect(estimate.quietPeriodMs()).toBeLessThanOrEqual(fast + 5)
  })
})

describe('remote element selection clicks', () => {
  it('selects at the click point immediately, ignoring a slower hover for another element', async () => {
    const harness = createHarness((query) => (query.kind === 'preview' ? 1000 : 100))
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    await vi.advanceTimersByTimeAsync(20)
    const selected = harness.session.select({ x: 700, y: 300 })
    // Dispatched now, alongside the one hover already in flight — not after it.
    expect(harness.queries.at(-1)).toMatchObject({ kind: 'select', point: { x: 700, y: 300 } })
    await vi.advanceTimersByTimeAsync(100)
    const outcome = await selected
    expect(outcome.kind === 'selected' ? outcome.payload.target.selector : null).toBe('#at-700-300')
    harness.session.setPaused(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(harness.previews.some((preview) => preview?.target.text === '10,10')).toBe(false)
  })

  it('selects before any hover preview has ever answered', async () => {
    const harness = createHarness(() => 500)
    await startSession(harness)
    const outcome = harness.session.select({ x: 3, y: 4 })
    await vi.advanceTimersByTimeAsync(500)
    expect((await outcome).kind).toBe('selected')
    expect(harness.queries.filter((query) => query.kind === 'preview')).toHaveLength(0)
  })

  it('turns a double click into exactly one selection', async () => {
    const harness = createHarness(() => 200)
    await startSession(harness)
    const first = harness.session.select({ x: 5, y: 5 })
    const second = harness.session.select({ x: 5, y: 5 })
    await vi.advanceTimersByTimeAsync(200)
    expect((await first).kind).toBe('selected')
    expect((await second).kind).toBe('ignored')
    expect(harness.queries.filter((query) => query.kind === 'select')).toHaveLength(1)
  })

  it('reports a selection as moved when geometry changes while it is in flight', async () => {
    const harness = createHarness(() => 300)
    await startSession(harness)
    const outcome = harness.session.select({ x: 20, y: 20 })
    await vi.advanceTimersByTimeAsync(100)
    harness.session.invalidateGeometry(null)
    await vi.advanceTimersByTimeAsync(300)
    expect((await outcome).kind).toBe('moved')
    expect(harness.session.isEnded).toBe(false)
  })

  it('reports a click on a frame that no longer matches the page as moved', async () => {
    const harness = createHarness(() => 10, {
      run: async (query) =>
        query.kind === 'select' ? { ...context, status: 'stale', reason: 'scroll' } : answer(query)
    })
    await startSession(harness)
    const outcome = harness.session.select({ x: 1, y: 1 })
    await vi.runOnlyPendingTimersAsync()
    expect((await outcome).kind).toBe('moved')
    expect(harness.session.isEnded).toBe(false)
  })

  it('drops a selection that lands after cancel', async () => {
    const harness = createHarness(() => 400)
    await startSession(harness)
    const outcome = harness.session.select({ x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(100)
    harness.session.cancel()
    await vi.advanceTimersByTimeAsync(400)
    expect((await outcome).kind).toBe('ignored')
    expect(harness.ended).toEqual([])
  })

  it('does not arm when cancelled before the host answers', async () => {
    const harness = createHarness(() => 300)
    const started = harness.session.start()
    harness.session.cancel()
    await vi.advanceTimersByTimeAsync(300)
    expect(await started).toBe(false)
    expect((await harness.session.select({ x: 1, y: 1 })).kind).toBe('ignored')
  })

  it('ends the picker when the host page navigated to another document', async () => {
    let document = context.document
    const harness = createHarness(() => 10, { run: async (query) => answer(query, document) })
    await startSession(harness)
    document = 'doc-2'
    harness.session.hover({ x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.ended).toHaveLength(1)
    expect(harness.session.isEnded).toBe(true)
    const sent = harness.queries.length
    harness.session.hover({ x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.queries.length).toBe(sent)
  })
})

describe('remote element selection failures', () => {
  it.each([
    'request timed out',
    'runtime unreachable',
    'Element selection returned an invalid response.'
  ])('ends on a failed preview (%s) instead of queueing a replacement', async (message) => {
    let previews = 0
    const harness = createHarness(() => 10, {
      run: async (query) => {
        if (query.kind === 'probe') {
          return answer(query)
        }
        previews += 1
        await new Promise((resolve) => setTimeout(resolve, 1000))
        throw new Error(message)
      }
    })
    await startSession(harness)
    harness.session.hover({ x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(500)
    // The pointer keeps moving while the failing query is still unresolved on the host.
    harness.session.hover({ x: 2, y: 2 })
    await vi.advanceTimersByTimeAsync(10_000)
    harness.session.hover({ x: 3, y: 3 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(previews).toBe(1)
    expect(harness.ended.map((error) => error.message)).toEqual([message])
    expect(harness.session.isEnded).toBe(true)
    expect((await harness.session.select({ x: 3, y: 3 })).kind).toBe('ignored')
  })

  it('retries a host viewport mismatch only a bounded number of times', async () => {
    let previews = 0
    const harness = createHarness(() => 10, {
      run: async (query) => {
        if (query.kind !== 'preview') {
          return answer(query)
        }
        previews += 1
        return { ...context, status: 'stale', reason: 'viewport' }
      }
    })
    await startSession(harness)
    harness.session.hover({ x: 1, y: 1 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(previews).toBe(3)
    expect(harness.session.isEnded).toBe(false)
  })
})

describe('remote element selection click ownership', () => {
  it.each([false, true])(
    'blocks hover dispatch during select (older preview: %s)',
    async (olderPreview) => {
      const harness = createControlledHarness()
      await startSession(harness)
      if (olderPreview) {
        harness.session.hover({ x: 10, y: 10 })
      }
      const selected = harness.session.select({ x: 700, y: 300 })
      harness.session.hover({ x: 900, y: 900 })
      await vi.advanceTimersByTimeAsync(1000)
      if (olderPreview) {
        const preview = harness.request('preview')
        preview.resolve(answer(preview.query))
        await vi.advanceTimersByTimeAsync(1000)
      }
      expect(harness.requests.filter(({ query }) => query.kind === 'preview')).toHaveLength(
        olderPreview ? 1 : 0
      )
      expect(harness.previews.filter(Boolean)).toEqual([])
      const select = harness.request('select')
      select.resolve(answer(select.query))
      expect(await selected).toMatchObject({
        kind: 'selected',
        payload: { target: { selector: '#at-700-300' } }
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(harness.requests).toHaveLength(olderPreview ? 3 : 2)
    }
  )

  it('keeps geometry invalidation authoritative without dispatching a preview during select', async () => {
    const harness = createControlledHarness()
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    const selected = harness.session.select({ x: 700, y: 300 })
    harness.session.invalidateGeometry({ x: 900, y: 900 })
    const preview = harness.request('preview')
    preview.resolve(answer(preview.query))
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.requests).toHaveLength(3)
    const select = harness.request('select')
    select.resolve(answer(select.query))
    expect(await selected).toEqual({ kind: 'moved' })
  })

  it.each(['document', 'viewport', 'scroll'] as const)(
    'retires an older stale %s response before its side effects',
    async (reason) => {
      const onViewport = vi.fn()
      const harness = createControlledHarness({ onViewport })
      await startSession(harness)
      onViewport.mockClear()
      harness.session.hover({ x: 10, y: 10 })
      const selected = harness.session.select({ x: 700, y: 300 })
      const preview = harness.request('preview')
      preview.resolve({
        ...context,
        status: 'stale',
        reason,
        viewport: { width: 2000, height: 2000 }
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(onViewport).not.toHaveBeenCalled()
      expect(harness.ended).toEqual([])
      expect(harness.requests).toHaveLength(3)
      const select = harness.request('select')
      select.resolve(answer(select.query))
      expect((await selected).kind).toBe('selected')
      expect(onViewport).toHaveBeenCalledExactlyOnceWith(viewport)
    }
  )

  it.each(['before selection', 'after confirmation', 'after resume'] as const)(
    'keeps the click when the retired preview fails %s and prevents any automatic new query',
    async (when) => {
      const harness = createControlledHarness()
      await startSession(harness)
      harness.session.hover({ x: 10, y: 10 })
      await vi.advanceTimersByTimeAsync(20)
      const selected = harness.session.select({ x: 700, y: 300 })
      const select = harness.request('select')
      if (when !== 'before selection') {
        select.resolve(answer(select.query))
        expect((await selected).kind).toBe('selected')
        if (when === 'after resume') {
          harness.session.setPaused(false)
          harness.session.hover({ x: 900, y: 900 })
        }
      }
      await vi.advanceTimersByTimeAsync(9980)
      harness.request('preview').reject(new Error('preview request timed out'))
      await vi.advanceTimersByTimeAsync(2020)
      if (when === 'before selection') {
        select.resolve(answer(select.query))
        expect(await selected).toMatchObject({
          kind: 'selected',
          payload: { target: { selector: '#at-700-300' } }
        })
      }
      expect(harness.ended).toHaveLength(when === 'after resume' ? 1 : 0)
      expect(harness.session.isEnded).toBe(when === 'after resume')
      expect(harness.session.requiresExplicitRearm).toBe(true)
      harness.session.setPaused(false)
      harness.session.hover({ x: 500, y: 500 })
      harness.session.invalidateGeometry({ x: 500, y: 500 })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await harness.session.select({ x: 500, y: 500 })).toEqual({ kind: 'ignored' })
      expect(harness.requests).toHaveLength(3)
    }
  )

  it('still rejects a select whose own response reports navigation after the retired preview fails', async () => {
    const harness = createControlledHarness()
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    const selected = harness.session.select({ x: 700, y: 300 })
    harness.request('preview').reject(new Error('request timed out'))
    await vi.advanceTimersByTimeAsync(1000)
    harness.request('select').resolve({ ...context, status: 'stale', reason: 'document' })
    expect(await selected).toEqual({ kind: 'ignored' })
    expect(harness.session.isEnded).toBe(true)
    expect(harness.ended).toHaveLength(1)
  })

  it('still discards the select on user cancel after a retired preview failure', async () => {
    const harness = createControlledHarness()
    await startSession(harness)
    harness.session.hover({ x: 10, y: 10 })
    const selected = harness.session.select({ x: 700, y: 300 })
    harness.request('preview').reject(new Error('request timed out'))
    await vi.advanceTimersByTimeAsync(1000)
    harness.session.cancel()
    const select = harness.request('select')
    select.resolve(answer(select.query))
    expect(await selected).toEqual({ kind: 'ignored' })
    expect(harness.ended).toEqual([])
  })
})
