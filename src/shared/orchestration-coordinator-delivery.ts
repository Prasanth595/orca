export type OrchestrationNotificationPolicy = 'all' | 'coordination'

export const ORCHESTRATION_COORDINATOR_DELIVERY_CAPABILITY =
  'orchestration.coordinator-delivery.v1' as const

export type CoordinatorPassOwner = {
  handle: string
  consumerGeneration: number
  processIncarnation: string
}

export function readCoordinatorPassOwner(
  payload: string | null | undefined
): CoordinatorPassOwner | null {
  if (!payload) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null || !('coordinatorPass' in parsed)) {
      return null
    }
    const owner = parsed.coordinatorPass
    return typeof owner === 'object' &&
      owner !== null &&
      'handle' in owner &&
      typeof owner.handle === 'string' &&
      'consumerGeneration' in owner &&
      typeof owner.consumerGeneration === 'number' &&
      'processIncarnation' in owner &&
      typeof owner.processIncarnation === 'string'
      ? {
          handle: owner.handle,
          consumerGeneration: owner.consumerGeneration,
          processIncarnation: owner.processIncarnation
        }
      : null
  } catch {
    return null
  }
}
