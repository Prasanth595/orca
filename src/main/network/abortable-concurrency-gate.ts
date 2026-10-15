import { abortSignalReason } from '../../shared/abort-signal-reason'

export type AbortableConcurrencyGate = {
  /** Runs `task` once a slot is free; an abort while queued rejects without running it. */
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>
  readonly active: number
  readonly queued: number
}

type Waiter = {
  resolve: () => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort: () => void
}

export function createAbortableConcurrencyGate(limit: number): AbortableConcurrencyGate {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Concurrency limit must be a positive integer')
  }
  let active = 0
  const waiters: Waiter[] = []

  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(abortSignalReason(signal))
    }
    if (active < limit) {
      active += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = waiters.indexOf(waiter)
          if (index !== -1 && signal) {
            waiters.splice(index, 1)
            reject(abortSignalReason(signal))
          }
        }
      }
      signal?.addEventListener('abort', waiter.onAbort, { once: true })
      waiters.push(waiter)
    })
  }

  // Why hand the slot over directly: decrementing first would let a new caller jump the queue.
  const release = (): void => {
    let next = waiters.shift()
    while (next) {
      next.signal?.removeEventListener('abort', next.onAbort)
      if (!next.signal?.aborted) {
        next.resolve()
        return
      }
      next.reject(abortSignalReason(next.signal))
      next = waiters.shift()
    }
    active -= 1
  }

  return {
    async run(task, signal) {
      await acquire(signal)
      try {
        return await task()
      } finally {
        release()
      }
    },
    get active() {
      return active
    },
    get queued() {
      return waiters.length
    }
  }
}
