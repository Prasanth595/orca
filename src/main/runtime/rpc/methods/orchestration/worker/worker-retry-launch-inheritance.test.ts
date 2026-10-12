import { describe, expect, it } from 'vitest'
import { inheritRetryLaunchSelection } from './worker-retry-launch-inheritance'
import type { WorkerStartInput } from './worker-start-schema'

function dbWithPrior(startOptions: unknown) {
  return {
    getWorkerDispatch: (id: string) =>
      id === 'ctx_prior'
        ? {
            start_options:
              typeof startOptions === 'string' ? startOptions : JSON.stringify(startOptions)
          }
        : null
  }
}

const recorded = {
  agent: 'claude',
  launch: {
    requested: { agent: 'claude', model: 'sonnet', effort: 'high' },
    effective: { agent: 'claude', model: 'sonnet', effort: 'high' }
  }
}

const retry: WorkerStartInput = { task: 'task_1', retryOf: 'ctx_prior', from: 'term_coord' }

describe('inheritRetryLaunchSelection', () => {
  it('reuses the retried Dispatch agent, model, and effort when none are passed', () => {
    expect(inheritRetryLaunchSelection(dbWithPrior(recorded), retry)).toMatchObject({
      agent: 'claude',
      model: 'sonnet',
      effort: 'high'
    })
  })

  it('leaves an explicit --agent and its own launch flags untouched', () => {
    const params = { ...retry, agent: 'codex' }
    expect(inheritRetryLaunchSelection(dbWithPrior(recorded), params)).toBe(params)
  })

  it('never inherits beside --terminal or for a remote --on retry', () => {
    const reused = { ...retry, terminal: 'term_worker' }
    expect(inheritRetryLaunchSelection(dbWithPrior(recorded), reused)).toBe(reused)
    const remote = { ...retry, on: 'remote-env' }
    expect(inheritRetryLaunchSelection(dbWithPrior(recorded), remote)).toBe(remote)
  })

  it('keeps an explicit --model and drops the effort recorded for the old model', () => {
    expect(
      inheritRetryLaunchSelection(dbWithPrior(recorded), { ...retry, model: 'opus' })
    ).toMatchObject({ agent: 'claude', model: 'opus', effort: undefined })
  })

  it('keeps an explicit --effort over the recorded one', () => {
    expect(
      inheritRetryLaunchSelection(dbWithPrior(recorded), { ...retry, effort: 'low' })
    ).toMatchObject({ agent: 'claude', model: 'sonnet', effort: 'low' })
  })

  it('falls through when the prior Dispatch reused a terminal or recorded nothing usable', () => {
    const reused = { launch: { requested: { agent: null, model: null, effort: null } } }
    expect(inheritRetryLaunchSelection(dbWithPrior(reused), retry)).toBe(retry)
    expect(inheritRetryLaunchSelection(dbWithPrior('{}'), retry)).toBe(retry)
    expect(inheritRetryLaunchSelection(dbWithPrior('not json'), retry)).toBe(retry)
    const unknownPrior = { ...retry, retryOf: 'ctx_other' }
    expect(inheritRetryLaunchSelection(dbWithPrior(recorded), unknownPrior)).toBe(unknownPrior)
  })

  it('does nothing without --retry-of', () => {
    const params = { task: 'task_1', from: 'term_coord' }
    expect(inheritRetryLaunchSelection(dbWithPrior(recorded), params)).toBe(params)
  })
})
