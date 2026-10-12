import '../unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { structuredAgentSessionCreateParams } from '../../../../shared/structured-agent-session-create'
import { AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY } from '../../../../shared/agent-session-create-capabilities'
import { setStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  createRestTestRig,
  type RestTestRig
} from '../../../native-chat/agent-session-wire/structured-agent-session-rest-test-rig'
import {
  allocationSnapshot,
  ALLOCATION_NOW
} from '../../structured-account-allocation.test-fixture'
import { dispatcher, STRUCTURED_CLIENT } from './structured-agent-session-rpc.test-fixture'
import type { ManagedStructuredCreateInput } from '../../managed-structured-account-home'

let rig: RestTestRig
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(ALLOCATION_NOW)
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  setStructuredAgentSessionHost(rig.host)
})
afterEach(async () => {
  setStructuredAgentSessionHost(null)
  await rig.dispose()
  vi.restoreAllMocks()
})

function harness() {
  let snapshot = allocationSnapshot()
  const refresh = vi.fn(async () => {})
  const resolve = vi.fn(async (input: ManagedStructuredCreateInput) => ({
    envelope: input.envelope,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'folder'
    },
    provider: input.agent,
    agent: input.agent,
    accountHome: input.pinnedAccountHome ?? {
      variable: 'CODEX_HOME',
      path: `/synthetic/${input.managedAccountId}`
    },
    runtimeKind: 'native'
  }))
  const rpc = dispatcher({
    refreshAccountsForMobileSubscriber: refresh,
    getAccountsSnapshot: () => snapshot,
    resolveStructuredAgentSessionCreateIntent: resolve
  })
  const send = async (params: ReturnType<typeof structuredAgentSessionCreateParams>) => {
    let response: unknown
    await rpc.dispatchStreaming(
      { id: 'request', authToken: 'token', method: 'agentSession.create', params },
      (raw) => {
        response = JSON.parse(raw)
      },
      {
        ...STRUCTURED_CLIENT,
        clientId: 'allocator',
        clientCapabilities: [
          ...STRUCTURED_CLIENT.clientCapabilities,
          AGENT_SESSION_CREATE_MESSAGE_RUNTIME_CAPABILITY
        ]
      }
    )
    if (response && typeof response === 'object' && 'error' in response) {
      throw new Error(JSON.stringify(response))
    }
    return response
  }
  return {
    send,
    refresh,
    resolve,
    unavailable: () => {
      snapshot = { ...snapshot, codex: { accounts: [], activeAccountId: null } }
    }
  }
}
function params(id: string) {
  return structuredAgentSessionCreateParams({
    sessionId: `codex_allocation_${id}`,
    worktree: 'id:workspace-1',
    agent: 'codex',
    accountAllocation: 'available',
    randomUuid: () => id.padStart(32, '0'),
    now: ALLOCATION_NOW
  })
}

it('commits different homes for simultaneous requests and replays the durable choice after accounts disappear', async () => {
  const h = harness()
  const first = params('1')
  const second = params('2')
  const responses = await Promise.all([h.send(first), h.send(second)])
  for (const response of responses) {
    expect(response).toMatchObject({ ok: true, result: { ok: true } })
  }
  expect(rig.store.getRecord(first.envelope.sessionId)?.accountHome).toEqual({
    variable: 'CODEX_HOME',
    path: '/synthetic/a'
  })
  expect(rig.store.getRecord(second.envelope.sessionId)?.accountHome).toEqual({
    variable: 'CODEX_HOME',
    path: '/synthetic/b'
  })
  h.unavailable()
  h.refresh.mockClear()
  expect(await h.send(first)).toMatchObject({ ok: true, result: { ok: true, replayed: true } })
  expect(h.refresh).not.toHaveBeenCalled()
  expect(rig.store.listRecords()).toHaveLength(2)
})

it('rejects an account/automatic conflict before quota refresh and rejects unknown quota before creation', async () => {
  const h = harness()
  const conflict = structuredAgentSessionCreateParams({
    ...params('3'),
    sessionId: 'codex_allocation_3',
    managedAccountId: 'a',
    randomUuid: () => '3'.padStart(32, '0'),
    now: ALLOCATION_NOW
  })
  expect(await h.send(conflict)).toMatchObject({ ok: true, result: { ok: false } })
  expect(h.refresh).not.toHaveBeenCalled()
  h.unavailable()
  expect(await h.send(params('4'))).toMatchObject({ ok: true, result: { ok: false } })
  expect(h.resolve).not.toHaveBeenCalled()
  expect(rig.store.listRecords()).toHaveLength(0)
})
