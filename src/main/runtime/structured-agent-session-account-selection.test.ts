import { expect, it } from 'vitest'
import { CreateIntentParams } from '../../shared/rpc-contract/structured-agent-session-params'
import { structuredAgentSessionCreateParams } from '../../shared/structured-agent-session-create'
import { structuredAgentSessionCreateIntentFingerprint } from './rpc/methods/structured-agent-session-create'

const args = {
  sessionId: 'codex_test',
  worktree: 'id:workspace',
  agent: 'codex',
  now: 1_800_000_000_000,
  randomUuid: () => '00000000-0000-0000-0000-000000000001'
} as const

it('includes the account in the replay fingerprint on both sides of the wire', () => {
  const first = structuredAgentSessionCreateParams({ ...args, managedAccountId: 'account-a' })
  const second = structuredAgentSessionCreateParams({ ...args, managedAccountId: 'account-b' })
  expect(CreateIntentParams.parse(first).managedAccountId).toBe('account-a')
  expect(first.envelope.payloadFingerprint).toBe(
    structuredAgentSessionCreateIntentFingerprint(first)
  )
  expect(second.envelope.payloadFingerprint).not.toBe(first.envelope.payloadFingerprint)
})

it('keeps the old request and fingerprint unchanged when no account is selected', () => {
  const absent = structuredAgentSessionCreateParams(args)
  const undefinedAccount = structuredAgentSessionCreateParams({
    ...args,
    managedAccountId: undefined
  })
  expect(absent).toEqual(undefinedAccount)
  expect('managedAccountId' in absent).toBe(false)
  expect(absent.envelope.payloadFingerprint).toBe(
    structuredAgentSessionCreateIntentFingerprint(absent)
  )
})
