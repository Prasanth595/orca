import type { CoordinatorPassOwner } from '../../../shared/orchestration-coordinator-delivery'
import type { OrchestrationDb } from './db'
import { OrchestrationError } from './orchestration-error'

export function assertCoordinatorPassOwner(input: {
  db: OrchestrationDb
  runId: string | undefined
  to: string | undefined
  type: string | undefined
  owner: CoordinatorPassOwner
  readProcessIncarnation: (handle: string) => string | null
}): void {
  const run = input.runId ? input.db.getRun(input.runId) : undefined
  if (
    !run ||
    run.legacy ||
    run.notification_policy !== 'coordination' ||
    input.to !== `run:${run.id}` ||
    input.type !== 'status' ||
    run.coordinator_handle !== input.owner.handle ||
    run.consumer_generation !== input.owner.consumerGeneration ||
    !run.coordinator_pane_key ||
    input.db.getCurrentRunForPane(run.coordinator_pane_key)?.id !== run.id
  ) {
    throw new OrchestrationError(
      'consumer_fenced',
      'The requested coordination owner is not current. No pass was queued.'
    )
  }
  let incarnation: string | null
  try {
    incarnation = input.readProcessIncarnation(input.owner.handle)
  } catch {
    throw new OrchestrationError(
      'coordinator_unverifiable',
      'The owning hub is not addressable. No pass was queued.'
    )
  }
  if (!incarnation) {
    throw new OrchestrationError(
      'coordinator_unverifiable',
      'The owning hub process cannot be verified. No pass was queued.'
    )
  }
  if (incarnation !== input.owner.processIncarnation) {
    throw new OrchestrationError(
      'consumer_fenced',
      'The owning hub process changed. No pass was queued.'
    )
  }
}
