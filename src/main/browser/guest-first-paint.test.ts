import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForGuestFirstPaint } from './guest-first-paint'

function paintState(painted: boolean, timeOrigin: number) {
  return { result: { type: 'object', value: [painted, timeOrigin] } }
}

function isFirstPaintWait(params: Record<string, unknown>): boolean {
  return params.awaitPromise === true
}

describe('waitForGuestFirstPaint', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets the input go when a stuck renderer never answers', async () => {
    vi.useFakeTimers()
    const holdPaint = vi.fn(() => () => {})
    const settled = vi.fn()
    void waitForGuestFirstPaint({}, () => new Promise(() => {}), holdPaint).then(settled)

    await vi.advanceTimersByTimeAsync(2_499)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledTimes(1)
    expect(holdPaint).not.toHaveBeenCalled()
  })

  it('sends nothing more and holds no paint for a document that has painted', async () => {
    const send = vi.fn(async () => paintState(true, 1))
    const holdPaint = vi.fn(() => () => {})

    await waitForGuestFirstPaint({}, send, holdPaint)

    expect(send).toHaveBeenCalledTimes(1)
    expect(holdPaint).not.toHaveBeenCalled()
  })

  it('draws a document that has never painted until it paints, then releases', async () => {
    const order: string[] = []
    const send = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      if (isFirstPaintWait(params)) {
        order.push('wait')
        return { result: { type: 'boolean', value: true } }
      }
      return paintState(false, 2)
    })
    const holdPaint = vi.fn(() => {
      order.push('hold')
      return () => order.push('release')
    })

    await waitForGuestFirstPaint({}, send, holdPaint)

    expect(order).toEqual(['hold', 'wait', 'release'])
  })

  it('waits on a document that never paints only once', async () => {
    const guest = {}
    const send = vi.fn(async (_method: string, params: Record<string, unknown>) =>
      isFirstPaintWait(params)
        ? { result: { type: 'boolean', value: false } }
        : paintState(false, 3)
    )
    const holdPaint = vi.fn(() => () => {})

    await waitForGuestFirstPaint(guest, send, holdPaint)
    await waitForGuestFirstPaint(guest, send, holdPaint)

    expect(holdPaint).toHaveBeenCalledTimes(1)
    // A new document in the same guest is waited on again.
    send.mockImplementation(async (_method: string, params: Record<string, unknown>) =>
      isFirstPaintWait(params) ? { result: { type: 'boolean', value: true } } : paintState(false, 4)
    )
    await waitForGuestFirstPaint(guest, send, holdPaint)
    expect(holdPaint).toHaveBeenCalledTimes(2)
  })

  it('makes callers that overlap on one document share its wait', async () => {
    let painted: (value: unknown) => void = () => {}
    const firstPaint = new Promise((resolve) => {
      painted = resolve
    })
    const send = vi.fn(async (_method: string, params: Record<string, unknown>) =>
      isFirstPaintWait(params) ? firstPaint : paintState(false, 6)
    )
    const holdPaint = vi.fn(() => () => {})
    const guest = {}
    const settled = vi.fn()

    const first = waitForGuestFirstPaint(guest, send, holdPaint).then(() => settled('first'))
    const second = waitForGuestFirstPaint(guest, send, holdPaint).then(() => settled('second'))
    await vi.waitFor(() => expect(holdPaint).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).not.toHaveBeenCalled()

    painted({ result: { type: 'boolean', value: true } })
    await Promise.all([first, second])
    expect(holdPaint).toHaveBeenCalledTimes(1)
    expect(settled.mock.calls).toEqual([['first'], ['second']])
  })

  it('releases the hold and lets the input go when the document goes away mid-wait', async () => {
    const release = vi.fn()
    const send = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      if (isFirstPaintWait(params)) {
        throw new Error('Execution context was destroyed')
      }
      return paintState(false, 5)
    })

    await expect(waitForGuestFirstPaint({}, send, () => release)).resolves.toBeUndefined()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('lets the input go when the page state cannot be read', async () => {
    const holdPaint = vi.fn(() => () => {})
    await expect(
      waitForGuestFirstPaint(
        {},
        vi.fn(async () => ({})),
        holdPaint
      )
    ).resolves.toBeUndefined()
    await expect(
      waitForGuestFirstPaint(
        {},
        vi.fn(async () => {
          throw new Error('Debugger is not attached to the target')
        }),
        holdPaint
      )
    ).resolves.toBeUndefined()
    expect(holdPaint).not.toHaveBeenCalled()
  })
})
