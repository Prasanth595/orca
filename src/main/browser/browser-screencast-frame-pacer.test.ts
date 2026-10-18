import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeBrowserScreencastFrame } from '../../shared/browser-screencast-protocol'
import { createBrowserScreencastFramePacer } from './browser-screencast-frame-pacer'
import { createMockScreencastWebContents } from './browser-screencast-web-contents-test-double'

function createPacerHarness() {
  const dbg = createMockScreencastWebContents().debugger
  const state = { accepted: true, stopping: false }
  const onFrame = vi.fn((_bytes: Uint8Array<ArrayBufferLike>) => state.accepted)
  const pacer = createBrowserScreencastFramePacer({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The pacer only calls sendCommand, provided by the shared debugger test double.
    dbg: dbg as never,
    options: {
      format: 'jpeg',
      quality: 70,
      maxWidth: 1289,
      maxHeight: 921,
      everyNthFrame: 1,
      minFrameIntervalMs: 33,
      onFrame
    },
    isClosed: () => false,
    isStopping: () => state.stopping
  })
  return {
    pacer,
    state,
    onFrame,
    queue: (text: string) =>
      pacer.queueFrame({ sessionId: 1, metadata: {}, image: Buffer.from(text) }),
    acknowledgements: () =>
      dbg.sendCommand.mock.calls
        .filter(([method]) => method === 'Page.screencastFrameAck')
        .map(([, params]) => params),
    images: () =>
      onFrame.mock.calls.map(([bytes]) => {
        const frame = decodeBrowserScreencastFrame(bytes)
        return frame ? Buffer.from(frame.image).toString() : undefined
      })
  }
}

describe('browser screencast frame credits', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
  })

  afterEach(() => vi.useRealTimers())

  it('acknowledges every event with the same session id and retains the terminal frame', async () => {
    const harness = createPacerHarness()
    harness.queue('first')
    await vi.advanceTimersByTimeAsync(5)
    harness.queue('middle')
    await vi.advanceTimersByTimeAsync(5)
    harness.queue('terminal')
    await vi.advanceTimersByTimeAsync(0)

    expect(harness.acknowledgements()).toEqual([{ sessionId: 1 }, { sessionId: 1 }])
    expect(harness.images()).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(23)

    expect(harness.images()).toEqual(['first', 'terminal'])
    expect(harness.acknowledgements()).toEqual([
      { sessionId: 1 },
      { sessionId: 1 },
      { sessionId: 1 }
    ])
    harness.pacer.clearPending(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.acknowledgements()).toHaveLength(3)
  })

  it.each([5, 40])(
    'returns a replaced credit after %i ms while holding the refused replacement until accepted',
    async (replacementDelay) => {
      const harness = createPacerHarness()
      harness.state.accepted = false
      harness.queue('refused-first')
      await vi.advanceTimersByTimeAsync(replacementDelay)
      harness.queue('replacement')
      await vi.advanceTimersByTimeAsync(0)

      expect(harness.acknowledgements()).toEqual([{ sessionId: 1 }])
      await vi.advanceTimersByTimeAsync(50)
      expect(harness.acknowledgements()).toHaveLength(1)
      expect(harness.images().at(-1)).toBe('replacement')
      harness.state.accepted = true
      await vi.advanceTimersByTimeAsync(50)

      expect(harness.acknowledgements()).toEqual([{ sessionId: 1 }, { sessionId: 1 }])
      expect(harness.images().at(-1)).toBe('replacement')
      const attempts = harness.onFrame.mock.calls.length
      await vi.advanceTimersByTimeAsync(100)
      expect(harness.onFrame).toHaveBeenCalledTimes(attempts)
    }
  )

  it('returns the retained credit once on stop and never emits its cancelled timer', async () => {
    const harness = createPacerHarness()
    harness.queue('first')
    await vi.advanceTimersByTimeAsync(5)
    harness.queue('middle')
    await vi.advanceTimersByTimeAsync(5)
    harness.queue('terminal')
    harness.state.stopping = true
    harness.pacer.clearPending(true)
    harness.pacer.clearPending(true)
    await vi.advanceTimersByTimeAsync(100)

    expect(harness.acknowledgements()).toHaveLength(3)
    expect(harness.images()).toEqual(['first'])
    expect(vi.getTimerCount()).toBe(0)
  })
})
