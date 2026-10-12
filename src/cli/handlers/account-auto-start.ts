import { rejectRemoteSelectionFlags } from '../remote-selection-flag-rejection'
import { randomUUID } from 'node:crypto'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { getRequiredWorktreeSelector } from '../selectors'
import { RuntimeClientError } from '../runtime-client'
import { printResult } from '../format'
import { AGENT_SESSION_CREATE_ALLOCATION_RUNTIME_CAPABILITY } from '../../shared/agent-session-create-capabilities'
import {
  createStructuredAgentSessionId,
  structuredAgentSessionCreateParams
} from '../../shared/structured-agent-session-create'
import type {
  AgentSessionAttachResult,
  AgentSessionMutationResult
} from '../../shared/agent-session-wire'

export const accountAutoStartHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  rejectRemoteSelectionFlags(flags, 'account auto-start; run this command on the execution host.')
  const agent = getRequiredStringFlag(flags, 'agent')
  if (agent !== 'claude' && agent !== 'codex') {
    throw new RuntimeClientError('invalid_argument', '--agent must be claude or codex.')
  }
  const status = await client.getCliStatus()
  if (
    !status.result.runtime.reachable ||
    !status.result.runtime.capabilities?.includes(
      AGENT_SESSION_CREATE_ALLOCATION_RUNTIME_CAPABILITY
    )
  ) {
    throw new RuntimeClientError(
      'incompatible_runtime',
      'This execution host cannot allocate an account to a new chat. Update Orca on the host; no session was created.'
    )
  }
  const params = structuredAgentSessionCreateParams({
    sessionId: createStructuredAgentSessionId(agent, randomUUID),
    worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client),
    agent,
    accountAllocation: 'available',
    randomUuid: randomUUID
  })
  const response = await client
    .call<AgentSessionMutationResult<AgentSessionAttachResult>>('agentSession.create', params, {
      timeoutMs: 300_000
    })
    .catch(() => {
      throw new RuntimeClientError(
        'agent_session_operation_unknown',
        `Creation could not be confirmed. Check chat ${params.envelope.sessionId} before creating another.`,
        { sessionId: params.envelope.sessionId, createParams: params }
      )
    })
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
      `Created ${agent} chat ${params.envelope.sessionId} with an automatically allocated account. Running sessions and the default account are unchanged.`
  )
}
