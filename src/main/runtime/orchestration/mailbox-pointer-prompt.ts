import { AgentPromptWriteSettlementError } from '../agent-prompt-write-settlement'
import {
  MAILBOX_POINTER_RESERVED,
  MAILBOX_POINTER_WRITE_ATTEMPTED,
  MAILBOX_POINTER_ENTER_ATTEMPTED
} from './db/messages/mailbox-pointer-enter-state'
import {
  shouldReleaseOrchestrationPointer,
  type OrchestrationMessageWaiter
} from './mailbox-pointer-eligibility'
import type { StagePointerArgs } from './mailbox-pointer-stage'
import type { OrchestrationMailboxDeliveryFlight } from './mailbox-pointer-state'
import type { OrchestrationMailboxPointerSubmitTarget } from './mailbox-pointer-submit'

export async function sendOrchestrationMailboxPointerPrompt<
  TWaiter extends OrchestrationMessageWaiter
>(
  args: StagePointerArgs<TWaiter>,
  target: OrchestrationMailboxPointerSubmitTarget,
  flight: OrchestrationMailboxDeliveryFlight,
  text: string
): Promise<void> {
  const ptyId = args.leaf.ptyId
  const send = args.deps.sendPrompt
  if (!ptyId) {
    return
  }
  const reservation = { ptyId, processIncarnation: target.processIncarnation }
  const ids = flight.stagedMessageIds
  const db = args.deps.getDb()
  const runId = args.mailboxHandle.slice('run:'.length)
  const generation = db?.getRun(runId)?.consumer_generation
  const requestId = `mailbox:${args.mailboxHandle}:${args.newestSequence}:${target.processIncarnation}`
  let phase = MAILBOX_POINTER_RESERVED
  let release = false
  let delivered = false
  const assertOwner = (): void => {
    const current = args.deps.resolveSubmitTarget(args.leaf, ptyId)
    if (
      !args.state.isCurrentFlight(ptyId, flight) ||
      !current?.leaf.writable ||
      current.terminalHandle !== target.terminalHandle ||
      current.processIncarnation !== target.processIncarnation ||
      args.deps.mailboxOwner.resolve(current.leaf, undefined, {
        terminalHandle: current.terminalHandle
      }) !== args.mailboxHandle ||
      args.deps.getDb()?.getRun(runId)?.consumer_generation !== generation ||
      shouldReleaseOrchestrationPointer(
        args.deps.getDb(),
        args.mailboxHandle,
        args.messages,
        args.deps.getMessageWaiters(args.mailboxHandle)
      )
    ) {
      throw new Error('mailbox_pointer_owner_changed')
    }
  }
  try {
    if (!send) {
      throw new Error('coordinator_delivery_unsupported')
    }
    const result = await send(target, text, {
      inputKind: 'driving',
      acceptQueued: true,
      requestId,
      requireWriteSettlement: true,
      beforeWrite: async () => {
        if (await args.deps.isLeafPtyProvenAbsent(ptyId)) {
          throw new Error('terminal_not_writable')
        }
        assertOwner()
        const currentDb = args.deps.getDb()
        const claimed =
          phase === MAILBOX_POINTER_RESERVED
            ? currentDb?.markMailboxPointerWriteAttempted(ids, reservation)
            : currentDb?.markMailboxPointerEnterAttempted(ids, reservation)
        if (!claimed) {
          throw new Error('mailbox_pointer_reservation_changed')
        }
        phase =
          phase === MAILBOX_POINTER_RESERVED
            ? MAILBOX_POINTER_WRITE_ATTEMPTED
            : MAILBOX_POINTER_ENTER_ATTEMPTED
      }
    })
    assertOwner()
    delivered =
      result.prompt?.requestId === requestId &&
      result.prompt.provider === 'codex' &&
      result.prompt.observation === 'supported' &&
      result.prompt.stages.includes('turn_started')
    if (delivered) {
      args.deps
        .getDb()
        ?.settleMailboxPointerEnter(ids, reservation, [MAILBOX_POINTER_ENTER_ATTEMPTED])
    }
  } catch (error) {
    // Only a pre-write failure or a settled refusal proves this phase left no bytes.
    release =
      phase === MAILBOX_POINTER_RESERVED ||
      (phase === MAILBOX_POINTER_WRITE_ATTEMPTED &&
        error instanceof AgentPromptWriteSettlementError &&
        error.settlement.outcome === 'refused')
    if (release && args.state.isCurrentFlight(ptyId, flight)) {
      try {
        args.deps.getDb()?.releaseMailboxPointerEnter(ids, reservation, [phase])
      } catch {
        release = false
      }
    }
  } finally {
    if (args.state.isCurrentFlight(ptyId, flight)) {
      if (delivered || release) {
        args.state.clearWatermark(args.mailboxHandle, args.newestSequence, ptyId)
      } else {
        args.state.deactivateWatermark(args.mailboxHandle, args.newestSequence, ptyId)
      }
    }
    args.settle(ptyId, flight)
    // A persistent pre-write refusal needs a new idle/event edge, not an immediate retry.
    if (delivered) {
      args.redrive(args.mailboxHandle)
    }
  }
}
