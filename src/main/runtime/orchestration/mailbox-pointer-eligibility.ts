import { ORCHESTRATION_DELIVERY_BATCH_LIMIT, type MessageRow, type OrchestrationDb } from './db'

export type OrchestrationMessageWaiter = { typeFilter: string[] | undefined }

export function messageTypeHasOrchestrationWaiter(
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined,
  messageType: string
): boolean {
  for (const waiter of waiters ?? []) {
    if (!waiter.typeFilter || waiter.typeFilter.includes(messageType)) {
      return true
    }
  }
  return false
}

export function hasUnfilteredOrchestrationWaiter(
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined
): boolean {
  for (const waiter of waiters ?? []) {
    if (!waiter.typeFilter) {
      return true
    }
  }
  return false
}

/**
 * The rows a pointer may carry right now.
 *
 * Both delivery lanes — bytes into a PTY, a turn into a structured session — select their batch
 * identically and differ only in what they do with it, so the selection lives here rather than
 * being kept in step in two copies. An unfiltered waiter owns the whole mailbox and yields an
 * empty batch: a caller blocked in `check --wait` preempts pointer delivery entirely.
 *
 * Type exclusion is exact in SQL and no post-filter is owed. The unfiltered case returns above, so
 * every remaining waiter contributes a concrete type list, and `messages.type` is TEXT with no
 * NOCASE collation — `NOT IN` is the same byte-exact test JS would repeat. Selection is synchronous
 * throughout, so no waiter can register partway through it either.
 */
export function selectOrchestrationPointerBatch(input: {
  db: OrchestrationDb
  mailboxHandle: string
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined
  reservedTypes: ReadonlySet<string> | undefined
  submitTarget?: { terminalHandle: string; processIncarnation: string } | null
}): MessageRow[] {
  if (hasUnfilteredOrchestrationWaiter(input.waiters)) {
    return []
  }
  const excludedTypes = new Set(input.reservedTypes)
  for (const waiter of input.waiters ?? []) {
    for (const type of waiter.typeFilter ?? []) {
      excludedTypes.add(type)
    }
  }
  const run = input.mailboxHandle.startsWith('run:')
    ? input.db.getRun(input.mailboxHandle.slice('run:'.length))
    : undefined
  return input.db.getUndeliveredUnreadMessages(input.mailboxHandle, undefined, {
    excludeTypes: [...excludedTypes],
    coordinationOnly: run?.notification_policy === 'coordination',
    coordinatorPassOwner:
      run && input.submitTarget
        ? {
            handle: input.submitTarget.terminalHandle,
            processIncarnation: input.submitTarget.processIncarnation,
            consumerGeneration: run.consumer_generation
          }
        : undefined,
    limit: ORCHESTRATION_DELIVERY_BATCH_LIMIT
  })
}

export function shouldReleaseOrchestrationPointer(
  db: OrchestrationDb | null,
  mailboxHandle: string,
  messages: readonly { id: string; type: string; payload?: string | null }[],
  waiters: ReadonlySet<OrchestrationMessageWaiter> | undefined
): boolean {
  for (const message of messages) {
    const owner = readCoordinatorPassOwner(message.payload)
    if (!owner) {
      continue
    }
    const run = mailboxHandle.startsWith('run:')
      ? db?.getRun(mailboxHandle.slice('run:'.length))
      : undefined
    if (
      !run ||
      run.consumer_generation !== owner.consumerGeneration ||
      run.coordinator_handle !== owner.handle
    )
      return true
  }
  if (db?.hasOutstandingMailboxDelivery?.(mailboxHandle)) {
    return true
  }
  if (messages.some((message) => messageTypeHasOrchestrationWaiter(waiters, message.type))) {
    return true
  }
  return !(
    db?.areUnreadMessages?.(
      mailboxHandle,
      messages.map((message) => message.id)
    ) ?? true
  )
}
import { readCoordinatorPassOwner } from '../../../shared/orchestration-coordinator-delivery'
