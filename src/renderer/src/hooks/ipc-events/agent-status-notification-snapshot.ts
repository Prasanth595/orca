import type {
  AgentStatusIpcPayload,
  ParsedAgentStatusPayload
} from '../../../../shared/agent-status-types'
import type { AgentCompletionStatusSnapshot } from '../../components/terminal-pane/agent-completion-coordinator-types'

export function agentStatusNotificationSnapshot(
  data: AgentStatusIpcPayload,
  payload: ParsedAgentStatusPayload
): AgentCompletionStatusSnapshot {
  return {
    ...payload,
    stateStartedAt: data.stateStartedAt,
    ...(data.providerPromptId ? { providerPromptId: data.providerPromptId } : {}),
    ...(data.providerSession ? { providerSession: data.providerSession } : {})
  }
}
