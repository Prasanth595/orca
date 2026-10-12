import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { ORCHESTRATION_HANDLERS } from './orchestration'
import { ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY } from '../../shared/orchestration-coordinator-delivery'

vi.mock('../format', () => ({ printResult: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
const requestId = '11111111-1111-4111-8111-111111111111'

it.each([undefined, 'all'])(
  'keeps policy %s compatible without the new feature capability',
  async (policy) => {
    const client = new RuntimeClient('/tmp/orca-cli-test', 1000, null, null)
    const call = vi
      .spyOn(client, 'call')
      .mockResolvedValue({
        id: 'test',
        ok: true,
        result: { run: { id: 'old-run', objective: 'Hub' } },
        _meta: { runtimeId: 'old-runtime' }
      })
    const flags = new Map([
      ['objective', 'Hub'],
      ['from', 'term_test']
    ])
    if (policy) {
      flags.set('notification-policy', policy)
    }
    await ORCHESTRATION_HANDLERS['orchestration run-create']({
      client,
      flags,
      cwd: '/tmp',
      json: true
    })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('orchestration.runCreate', {
      from: 'term_test',
      objective: 'Hub',
      ...(policy ? { notificationPolicy: policy } : {})
    })
  }
)

it('capability-gates the opt-in Run and reuses durable send for a fenced timer pass', async () => {
  const client = new RuntimeClient('/tmp/orca-cli-test', 1000, null, null)
  const call = vi.spyOn(client, 'call').mockResolvedValue({
    id: 'test',
    ok: true,
    result: {
      run: { id: 'run_test', objective: 'Hub' },
      capabilities: [ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY]
    },
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
  expect(call).toHaveBeenCalledWith('orchestration.runCreate', {
    from: 'term_test',
    objective: 'Hub',
    notificationPolicy: 'coordination'
  })
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
      orchestrationRequestId: requestId
    }
  )
  expect(call.mock.calls.some(([method]) => method === 'orchestration.runUse')).toBe(false)
})

it.each(['orchestration request-pass', 'orchestration run-create'])(
  'refuses an older contract-v1 peer before %s can apply stripped parameters',
  async (command) => {
    const client = new RuntimeClient('/tmp/orca-cli-test', 1000, null, null)
    const call = vi
      .spyOn(client, 'call')
      .mockResolvedValue({
        id: 'old-host',
        ok: true,
        result: { capabilities: ['orchestration.contract.v1'] },
        _meta: { runtimeId: 'old-runtime' }
      })
    await expect(
      ORCHESTRATION_HANDLERS[command]({
        client,
        cwd: '/tmp',
        json: true,
        flags: new Map([
          ['run', 'run_test'],
          ['from', 'term_test'],
          ['owner', 'term_hub'],
          ['consumer-generation', '1'],
          ['process-incarnation', 'inc'],
          ['objective', 'Hub'],
          ['notification-policy', 'coordination']
        ])
      })
    ).rejects.toMatchObject({ code: 'incompatible_runtime' })
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('status.get')
  }
)
