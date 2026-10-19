import type { StructuredAgentSessionAttachContext } from './structured-agent-session-attach-context'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import type { StructuredAgentSessionConversationLifetime } from './structured-agent-session-conversation-lifetime'
import type { StructuredAgentSessionClientDelivery } from './structured-agent-session-client-delivery'
import {
  ensureStructuredAgentSessionAgentForOperation,
  joinClosingStructuredAgentSessionChild
} from './structured-agent-session-agent-start'

/** The mutation collaborators share the same attach and lifetime bindings as the host. */
export function structuredAgentSessionHostMutationContext(
  attach: StructuredAgentSessionAttachContext,
  lifetime: StructuredAgentSessionConversationLifetime,
  delivery: StructuredAgentSessionClientDelivery,
  wakeQueuedDrain: (sessionId: string) => void,
  wakeDelivery: (sessionId: string) => void
): StructuredAgentSessionMutationContext {
  return {
    ...attach,
    startupAttempts: attach.runtimeState.startupAttempts,
    deliveryOrder: attach.runtimeState.deliveryOrder,
    wakeDelivery,
    publish: (sessionId, journal) => attach.subscribers.publish(sessionId, journal),
    conversation: lifetime.conversation,
    readChildWork: delivery.readChildWork,
    publishChildWork: delivery.publishChildWork,
    publishWorkChanged: delivery.publishGenerationEnded,
    captureChildWorkStops: delivery.captureChildWorkStops,
    childWorkOpen: delivery.childWorkOpen,
    childWorkIncomplete: delivery.childWorkIncomplete,
    ensureAgent: (sessionId) => ensureStructuredAgentSessionAgentForOperation(attach, sessionId),
    joinChildClose: (sessionId) => joinClosingStructuredAgentSessionChild(attach, sessionId),
    stopAgent: (sessionId, ending) => lifetime.stopAgent(sessionId, ending),
    wakeQueuedDrain,
    acquireAborts: attach.runtimeState.acquireAborts
  }
}
