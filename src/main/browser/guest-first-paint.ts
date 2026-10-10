import type { CapturePaintHold } from './cdp-screenshot'

/** Sends one CDP command to the guest, or to one of its sessions. */
export type GuestCdpSend = (method: string, params: Record<string, unknown>) => Promise<unknown>

// Why a bound: a document that draws nothing (a blank page) reports no paint and runs no frames.
const FIRST_PAINT_WAIT_MS = 2_000
// Why: Chromium leaves paint timing out for some documents that do draw, so drawn frames stand in.
const FIRST_PAINT_FRAMES = 6

const PAINT_STATE_EXPRESSION =
  "[performance.getEntriesByType('paint').length > 0, performance.timeOrigin]"

const FIRST_PAINT_EXPRESSION = `new Promise((resolve) => {
  if (performance.getEntriesByType('paint').length > 0) return resolve(true)
  const observer = new PerformanceObserver(() => done(true))
  const timer = setTimeout(() => done(false), ${FIRST_PAINT_WAIT_MS})
  let frames = 0
  const onFrame = () => (++frames >= ${FIRST_PAINT_FRAMES} ? done(false) : requestAnimationFrame(onFrame))
  function done(painted) {
    observer.disconnect()
    clearTimeout(timer)
    resolve(painted)
  }
  observer.observe({ type: 'paint' })
  requestAnimationFrame(onFrame)
})`

// Why: a renderer whose main thread is stuck never answers; the input then goes out as before.
const CHECK_TIMEOUT_MS = FIRST_PAINT_WAIT_MS + 500

// Why: guest -> the last document waited on, so one that paints nothing costs the bound once.
const waitedTimeOrigins = new WeakMap<object, number>()

function withinCheckTimeout<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('first-paint check timed out')), CHECK_TIMEOUT_MS)
  })
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer))
}

function readEvaluatedValue(reply: unknown): unknown {
  const result = reply !== null && typeof reply === 'object' ? Reflect.get(reply, 'result') : null
  return result !== null && typeof result === 'object' ? Reflect.get(result, 'value') : undefined
}

/**
 * Draws a guest whose document has never painted until it does, before pointer input reaches it.
 *
 * Why: Chromium holds a mouse move for a frame and can drop a mouse press that arrives before the
 * document's first paint, while still acking the CDP call. A document that loads in a parked pane
 * never paints, so a click there waited ~5 s for the move, and its press could still be dropped.
 */
export async function waitForGuestFirstPaint(
  guest: object,
  send: GuestCdpSend,
  holdPaint: CapturePaintHold
): Promise<void> {
  try {
    const state = readEvaluatedValue(
      await withinCheckTimeout(
        send('Runtime.evaluate', {
          expression: PAINT_STATE_EXPRESSION,
          returnByValue: true,
          silent: true
        })
      )
    )
    if (!Array.isArray(state) || state[0] === true || typeof state[1] !== 'number') {
      return
    }
    if (waitedTimeOrigins.get(guest) === state[1]) {
      return
    }
    waitedTimeOrigins.set(guest, state[1])
    const release = holdPaint()
    try {
      await withinCheckTimeout(
        send('Runtime.evaluate', {
          expression: FIRST_PAINT_EXPRESSION,
          awaitPromise: true,
          returnByValue: true,
          silent: true
        })
      )
    } finally {
      release()
    }
  } catch {
    // Why: a navigation can replace the document mid-check; the input then goes out as before.
  }
}
