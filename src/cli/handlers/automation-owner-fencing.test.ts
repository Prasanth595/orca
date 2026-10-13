import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTOMATION_SEMANTIC_EVALUATION_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { AUTOMATION_HANDLERS } from './automations'

const owner = { selector: { kind: 'ssh', targetId: 'box', targetGeneration: 4 } }

function ok(result: unknown): unknown {
  return { id: 'request-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function clientAnsweringShow(owner: unknown): { call: ReturnType<typeof vi.fn> } {
  const call = vi.fn(async (method: string) =>
    method === 'automation.show'
      ? ok(owner === undefined ? { automation: { id: 'a1' } } : { automation: { id: 'a1' }, owner })
      : ok({ automation: { id: 'a1' }, removed: true, id: 'a1', run: { id: 'r1' } })
  )
  return { call }
}

afterEach(() => vi.restoreAllMocks())

// Why: the fence refuses an unfenced mutation on a generation-bearing SSH record, so
// every CLI mutation has to read the owner first or it cannot touch its own host.
describe('CLI automation mutations carry the owner they read', () => {
  it.each([
    ['automations remove', 'automation.delete'],
    ['automations run', 'automation.runNow']
  ])('%s sends the owner from automation.show to %s', async (command, method) => {
    const { call } = clientAnsweringShow(owner)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS[command]!({
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([['id', 'a1']]),
      json: true
    })

    expect(call).toHaveBeenNthCalledWith(1, 'automation.show', { id: 'a1' })
    expect(call).toHaveBeenNthCalledWith(2, method, { id: 'a1', expectedOwner: owner })
  })

  it('edit sends the owner alongside the update payload', async () => {
    const { call } = clientAnsweringShow(owner)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations edit']!({
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([
        ['id', 'a1'],
        ['name', 'renamed']
      ]),
      json: true
    })

    expect(call).toHaveBeenNthCalledWith(
      2,
      'automation.update',
      expect.objectContaining({ id: 'a1', expectedOwner: owner })
    )
  })

  it('refuses a semantic evaluation edit before an older host can drop the config', async () => {
    const call = vi.fn(async (method: string) =>
      method === 'status.get' ? ok({ capabilities: [] }) : ok({ automation: { id: 'a1' }, owner })
    )

    await expect(
      AUTOMATION_HANDLERS['automations edit']!({
        client: { call } as never,
        cwd: '/tmp',
        flags: new Map([
          ['id', 'a1'],
          ['jev-evaluation', 'shadow'],
          ['jev-rubric', 'rubrics/memory.json']
        ]),
        json: true
      })
    ).rejects.toMatchObject({
      code: 'incompatible_runtime',
      message:
        'Jev automation evaluation requires a newer Orca server. Update the HUB and try again.'
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('status.get')
  })

  it('persists a semantic evaluation edit after the host advertises support', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return ok({ capabilities: [AUTOMATION_SEMANTIC_EVALUATION_RUNTIME_CAPABILITY] })
      }
      if (method === 'automation.show') {
        return ok({ automation: { id: 'a1' }, owner })
      }
      return ok({ automation: { id: 'a1' } })
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations edit']!({
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([
        ['id', 'a1'],
        ['jev-evaluation', 'enforced'],
        ['jev-rubric', 'rubrics/memory.json']
      ]),
      json: true
    })

    expect(call).toHaveBeenNthCalledWith(1, 'status.get')
    expect(call).toHaveBeenNthCalledWith(
      3,
      'automation.update',
      expect.objectContaining({
        updates: expect.objectContaining({
          semanticEvaluation: {
            evaluator: 'jev',
            mode: 'enforced',
            rubricPath: 'rubrics/memory.json'
          }
        })
      })
    )
  })

  // An older host has no fence to satisfy, so a missing owner must not become a
  // fabricated one — and must not stop the mutation either.
  it('omits the precondition when the host reports no owner', async () => {
    const { call } = clientAnsweringShow(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations run']!({
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([['id', 'a1']]),
      json: true
    })

    expect(call).toHaveBeenNthCalledWith(2, 'automation.runNow', { id: 'a1' })
  })

  it('leaves reads unfenced, so listing still works on a record whose host is gone', async () => {
    const { call } = clientAnsweringShow(owner)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations runs']!({
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([['id', 'a1']]),
      json: true
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('automation.runs', {
      automationId: 'a1',
      cursor: undefined,
      limit: undefined,
      since: undefined,
      status: undefined
    })
  })
})
