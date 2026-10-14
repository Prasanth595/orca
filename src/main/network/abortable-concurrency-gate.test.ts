import { describe, expect, it } from 'vitest'
import { createAbortableConcurrencyGate } from './abortable-concurrency-gate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe('createAbortableConcurrencyGate', () => {
  it('runs at most `limit` tasks at once, in arrival order', async () => {
    const gate = createAbortableConcurrencyGate(2)
    const blockers = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const runs = blockers.map((blocker, index) =>
      gate.run(async () => {
        started.push(index)
        await blocker.promise
        return index
      })
    )
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    expect(gate.active).toBe(2)
    expect(gate.queued).toBe(1)
    blockers[1].resolve()
    await runs[1]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])
    blockers[0].resolve()
    blockers[2].resolve()
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2])
    expect(gate.active).toBe(0)
  })

  it('releases the slot when a task throws', async () => {
    const gate = createAbortableConcurrencyGate(1)
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(gate.run(async () => 'next')).resolves.toBe('next')
  })

  it('drops a queued task whose signal aborts, without running it', async () => {
    const gate = createAbortableConcurrencyGate(1)
    const blocker = deferred()
    const first = gate.run(() => blocker.promise)
    const controller = new AbortController()
    let ran = false
    const queued = gate.run(async () => {
      ran = true
    }, controller.signal)
    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(gate.queued).toBe(0)
    blocker.resolve()
    await first
    expect(ran).toBe(false)
    expect(gate.active).toBe(0)
  })

  it('rejects at once for an already aborted signal', async () => {
    const gate = createAbortableConcurrencyGate(1)
    await expect(gate.run(async () => 1, AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(gate.active).toBe(0)
  })

  it('rejects an invalid limit', () => {
    expect(() => createAbortableConcurrencyGate(0)).toThrow(RangeError)
  })
})
