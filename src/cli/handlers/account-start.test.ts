import { beforeEach, expect, it, vi } from 'vitest'
import { accountStartHandler } from './account-start'
import type { RuntimeClient } from '../runtime-client'
import { AGENT_SESSION_CREATE_ACCOUNT_RUNTIME_CAPABILITY } from '../../shared/agent-session-create-capabilities'

const mocks = vi.hoisted(() => ({
  printResult: vi.fn(),
  getRequiredWorktreeSelector: vi.fn(async () => 'id:workspace')
}))
vi.mock('../format', () => ({ printResult: mocks.printResult }))
vi.mock('../selectors', () => ({ getRequiredWorktreeSelector: mocks.getRequiredWorktreeSelector }))

const getCliStatus = vi.fn()
const call = vi.fn()
function context() {
  return {
    flags: new Map<string, string | boolean>([
      ['agent', 'codex'],
      ['account', 'account-b'],
      ['worktree', 'id:workspace']
    ]),
    cwd: '/synthetic',
    json: true,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler only calls getCliStatus and call; the selector is mocked above.
    client: { getCliStatus, call } as unknown as RuntimeClient
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  getCliStatus.mockResolvedValue({
    result: {
      runtime: { reachable: true, capabilities: [AGENT_SESSION_CREATE_ACCOUNT_RUNTIME_CAPABILITY] }
    }
  })
  call.mockResolvedValue({ ok: true, result: { ok: true, value: { sessionId: 'created' } } })
})

it('pins the requested account without ever selecting a global account', async () => {
  await accountStartHandler(context())
  expect(call).toHaveBeenCalledOnce()
  expect(call).toHaveBeenCalledWith(
    'agentSession.create',
    expect.objectContaining({
      managedAccountId: 'account-b',
      agent: 'codex',
      worktree: 'id:workspace',
      envelope: expect.objectContaining({
        sessionId: expect.stringMatching(/^codex_/),
        payloadFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    }),
    { timeoutMs: 300_000 }
  )
})

it('refuses an older or unreachable host without a downgraded create', async () => {
  getCliStatus.mockResolvedValue({ result: { runtime: { reachable: true, capabilities: [] } } })
  await expect(accountStartHandler(context())).rejects.toThrow('no session was created')
  expect(call).not.toHaveBeenCalled()
})

it('surfaces a host refusal rather than reporting a created chat', async () => {
  call.mockResolvedValue({
    ok: true,
    result: {
      ok: false,
      refusal: { code: 'agent_session_operation_invalid', message: 'Account unavailable' }
    }
  })
  await expect(accountStartHandler(context())).rejects.toThrow('Account unavailable')
  expect(mocks.printResult).not.toHaveBeenCalled()
})

it('refuses remote selectors before resolving the local runtime', async () => {
  const ctx = context()
  ctx.flags.set('environment', 'remote')
  await expect(accountStartHandler(ctx)).rejects.toThrow('does not retarget')
  expect(getCliStatus).not.toHaveBeenCalled()
  expect(call).not.toHaveBeenCalled()
})
it('reports the durable create intent on an unconfirmed transport outcome', async () => {
  call.mockRejectedValue(new Error('disconnected'))
  await expect(accountStartHandler(context())).rejects.toMatchObject({
    code: 'agent_session_operation_unknown',
    data: { createParams: { managedAccountId: 'account-b' } }
  })
  expect(mocks.printResult).not.toHaveBeenCalled()
})
