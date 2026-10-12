import { expect, it } from 'vitest'
import { mapRuntimeError } from './errors'
import { OrchestrationError } from '../orchestration/orchestration-error'

it.each(['coordinator_delivery_unsupported', 'coordinator_unverifiable'])(
  'preserves %s as an explicit RPC refusal',
  (code) => {
    expect(
      mapRuntimeError(
        'delivery',
        { runtimeId: 'test-runtime' },
        new OrchestrationError(code, 'No effects were applied.', { effectsApplied: false })
      )
    ).toMatchObject({ error: { code, data: { effectsApplied: false } } })
  }
)
