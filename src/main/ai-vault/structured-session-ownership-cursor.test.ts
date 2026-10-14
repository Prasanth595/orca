import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSessionProviderHandle } from '../../shared/agent-session-provider-handle'
import { getAgentResumeArgv } from '../../shared/agent-resume-argv'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  assertLegacyAiVaultResumeAllowed,
  assertLegacyAiVaultResumeCommandAllowed,
  OPENS_EVERY_STRUCTURED_CHAT,
  projectStructuredAiVaultSessions
} from './structured-session-ownership'
import { installOwnership, listResult } from './structured-session-ownership.test-support'

const CURSOR_UUID = '76153937-b313-42ae-b70d-37320a0449cf'
const OTHER_UUID = 'c5066bf8-49c9-4e26-aa5f-31e940b08569'
// The SDK's agent id, and the transcript the Cursor CLI's history lists it by.
const HANDLE: AgentSessionProviderHandle = {
  transport: 'cursor-sdk',
  agent: 'cursor',
  nativeId: `agent-${CURSOR_UUID}`
}
const transcript = (uuid: string) =>
  `/Users/me/.cursor/projects/Users-me-repo/agent-transcripts/agent-${uuid}/agent-${uuid}.jsonl`

const allowed = (command: string) =>
  expect(
    assertLegacyAiVaultResumeCommandAllowed(command, async () => undefined)
  ).resolves.toBeUndefined()
const refused = (command: string) =>
  expect(assertLegacyAiVaultResumeCommandAllowed(command, async () => undefined)).rejects.toThrow(
    'agent_session_conflict'
  )

function ownedRow(sessionId: string) {
  const result = listResult()
  result.sessions = [
    {
      ...result.sessions[0]!,
      agent: 'cursor',
      sessionId,
      filePath: transcript(sessionId),
      title: 'First prompt'
    }
  ]
  return projectStructuredAiVaultSessions(result, OPENS_EVERY_STRUCTURED_CHAT).sessions[0]
}

afterEach(() => setStructuredAgentSessionHost(null))

describe('Session History rows owned by a Cursor chat', () => {
  it('owns the row its SDK transcript lists as and refuses preparing its resume', () => {
    installOwnership({ handle: HANDLE, conversationName: 'Quokka harbor chat' })
    expect(ownedRow(CURSOR_UUID)).toMatchObject({
      title: 'First prompt',
      structuredSession: { sessionId: 'session-alpha', workspaceId: 'workspace-1' }
    })
    expect(ownedRow(OTHER_UUID)).not.toHaveProperty('structuredSession')
    expect(() =>
      assertLegacyAiVaultResumeAllowed({
        agent: 'cursor',
        sessionId: CURSOR_UUID,
        filePath: transcript(CURSOR_UUID),
        codexHome: null,
        executionHostId: 'local'
      })
    ).toThrow('agent_session_conflict')
  })
})

describe('terminal resumes of a conversation a Cursor chat owns', () => {
  it.each([
    getAgentResumeArgv('cursor', { key: 'conversation_id', id: CURSOR_UUID })!.join(' '),
    `cursor-agent --resume agent-${CURSOR_UUID}`,
    `cursor-agent --resume=agent-${CURSOR_UUID.toUpperCase()}`,
    `cursor-agent -p "keep going" --resume ${CURSOR_UUID}`,
    `cursor-agent --resume`,
    `cursor-agent --resume --force`,
    `cursor-agent --continue`,
    `cursor-agent resume`,
    `cursor-agent ls`
  ])('refuses %s', async (command) => {
    installOwnership({ handle: HANDLE })
    await refused(command)
  })

  it.each([
    `cursor-agent --resume agent-${OTHER_UUID}`,
    `cursor-agent "resume the refactor"`,
    `cursor-agent models`,
    `cursor-agent`
  ])('allows %s', async (command) => {
    installOwnership({ handle: HANDLE })
    await allowed(command)
  })
})
