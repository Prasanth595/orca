import { randomUUID } from 'node:crypto'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { getRequiredWorktreeSelector } from '../selectors'
import { RuntimeClientError } from '../runtime-client'
import { printResult } from '../format'
import { AGENT_SESSION_CREATE_ACCOUNT_RUNTIME_CAPABILITY } from '../../shared/agent-session-create-capabilities'
import {
  createStructuredAgentSessionId,
  structuredAgentSessionCreateParams
} from '../../shared/structured-agent-session-create'
import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult
} from '../../shared/agent-session-wire'

export const accountStartHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const agent = getRequiredStringFlag(flags, 'agent')
  if (agent !== 'claude' && agent !== 'codex') {
    throw new RuntimeClientError('invalid_argument', '--agent must be claude or codex.')
  }
  const accountId = getRequiredStringFlag(flags, 'account')
  const status = await client.getCliStatus()
  if (
    !status.result.runtime.reachable ||
    !status.result.runtime.capabilities?.includes(AGENT_SESSION_CREATE_ACCOUNT_RUNTIME_CAPABILITY)
  ) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This execution host cannot pin a managed account to a new chat. Update Orca on the host; no session was created.'
    )
  }
  const params = structuredAgentSessionCreateParams({
    sessionId: createStructuredAgentSessionId(agent, randomUUID),
    worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client),
    agent,
    managedAccountId: accountId,
    randomUuid: randomUUID
  })
  const response = await client.call<AgentSessionMutationResult<AgentSessionAttachResult>>(
    'agentSession.create',
    params
  )
  if (!response.result.ok) {
    throw new RuntimeClientError(
      response.result.refusal.code,
      response.result.refusal.message ?? 'The execution host refused to create this session.'
    )
  }
  printResult(
    response,
    json,
    () =>
      `Created ${agent} chat ${params.envelope.sessionId} using account ${accountId}. Running sessions and the default account are unchanged.`
  )
}
