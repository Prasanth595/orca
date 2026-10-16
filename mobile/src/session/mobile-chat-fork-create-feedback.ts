import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import { RpcIncompatibleReplyError } from '../transport/rpc-incompatible-reply-error'
import { PROJECT_RUNTIME_REPAIR_REQUIRED_CODE } from '../../../src/shared/project-runtime-repair-message'

export function mobileChatForkRefusalMessage(agentName: string, code: string): string {
  const guidance = code === 'chat_fork_anchor_changed'
    ? 'Select a tab and try again.'
    : code === 'chat_fork_runtime_incompatible'
      ? 'Open the chat in a native workspace on its host and try again.'
      : code === 'chat_fork_source_unavailable'
        ? "Check that the chat has a saved conversation and review the agent's command and settings on the host, then try again."
        : code === PROJECT_RUNTIME_REPAIR_REQUIRED_CODE
          ? 'Review Project Runtime settings on the host and restore native Windows execution for this chat, then try again.'
          : 'Reconnect and check open tabs on the host before retrying.'
  return `Could not open ${agentName} in a new CLI. ${guidance}`
}

export function mobileChatForkRequestFailureMessage(agentName: string, error: unknown): string {
  return isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error) ||
    error instanceof RpcIncompatibleReplyError
    ? `${agentName} may have opened. Reconnect and check open tabs on the host before retrying.`
    : `Could not open ${agentName} in a new CLI. Check the chat and host settings, then try again.`
}
