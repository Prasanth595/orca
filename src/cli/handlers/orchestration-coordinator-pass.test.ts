import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient, RuntimeClientError } from '../runtime-client'
import { ORCHESTRATION_HANDLERS } from './orchestration'
import { ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY } from '../../shared/orchestration-coordinator-delivery'

vi.mock('../format', () => ({ printResult: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
const requestId = '11111111-1111-4111-8111-111111111111'

it('capability-gates the opt-in Run and reuses durable send for a fenced timer pass', async () => {
  const client = new RuntimeClient('/tmp/orca-cli-test', 1000, null, null)
  const call = vi.spyOn(client, 'call').mockResolvedValue({
    id: 'test',
    ok: true,
    result: { run: { id: 'run_test', objective: 'Hub' } },
    _meta: { runtimeId: 'test-runtime' }
  })
  const context = { client, cwd: '/tmp/orca-cli-test', json: true }
  await ORCHESTRATION_HANDLERS['orchestration run-create']({
    ...context,
    flags: new Map([
      ['objective', 'Hub'],
      ['from', 'term_test'],
      ['notification-policy', 'coordination']
    ])
  })
  expect(call).toHaveBeenCalledWith(
    'orchestration.runCreate',
    { from: 'term_test', objective: 'Hub', notificationPolicy: 'coordination' },
    { orchestrationCapability: ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY }
  )
  await ORCHESTRATION_HANDLERS['orchestration request-pass']({
    ...context,
    flags: new Map([
      ['run', 'run_test'],
      ['from', 'term_test'],
      ['owner', 'term_hub'],
      ['consumer-generation', '3'],
      ['process-incarnation', 'inc'],
      ['retry-request', requestId]
    ])
  })
  expect(call).toHaveBeenLastCalledWith(
    'orchestration.send',
    expect.objectContaining({
      from: 'term_test',
      to: 'run:run_test',
      run: 'run_test',
      type: 'status',
      coordinatorPass: { handle: 'term_hub', consumerGeneration: 3, processIncarnation: 'inc' }
    }),
    {
      orchestrationCapability: ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY,
      orchestrationRequestId: requestId
    }
  )
  expect(call.mock.calls.some(([method]) => method === 'orchestration.runUse')).toBe(false)
})

it('keeps unsupported peer refusal explicit without fallback or a second send', async () => {
  const client = new RuntimeClient('/tmp/orca-cli-test', 1000, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockRejectedValue(new RuntimeClientError('unsupported_capability', 'Older peer'))
  await expect(
    ORCHESTRATION_HANDLERS['orchestration request-pass']({
      client,
      cwd: '/tmp',
      json: true,
      flags: new Map([
        ['run', 'run_test'],
        ['from', 'term_test'],
        ['owner', 'term_hub'],
        ['consumer-generation', '1'],
        ['process-incarnation', 'inc']
      ])
    })
  ).rejects.toMatchObject({ code: 'unsupported_capability' })
  expect(call).toHaveBeenCalledTimes(1)
})
