import type { CoordinatorPassOwner } from '../../../../../shared/orchestration-coordinator-delivery'

export type MailboxPointerQueryOptions = {
  excludeTypes?: readonly string[]
  limit?: number
  coordinationOnly?: boolean
  coordinatorPassOwner?: CoordinatorPassOwner
}

// CASE keeps malformed ordinary status payloads readable without evaluating JSON functions on them.
export const COORDINATION_POINTER_CONDITION = `(type IN ('worker_done', 'escalation', 'question') OR
  (CASE WHEN json_valid(payload) THEN
    json_type(payload, '$._orcaLifecycleRejection') = 'object' AND
    json_type(payload, '$._orcaLifecycleRejection.code') = 'text' AND
    json_type(payload, '$._orcaLifecycleRejection.reason') = 'text' END)
  OR
  (type = 'status' AND CASE WHEN json_valid(payload)
    THEN json_extract(payload, '$.materialKind') END IN ('dependency-change', 'delivery-risk'))
  OR (type = 'status' AND CASE WHEN json_valid(payload) THEN
    json_extract(payload, '$.coordinatorPass.handle') = ? AND
    json_extract(payload, '$.coordinatorPass.consumerGeneration') = ? AND
    json_extract(payload, '$.coordinatorPass.processIncarnation') = ? END))`

export function coordinatorPointerParams(
  owner: CoordinatorPassOwner | undefined
): (string | number)[] {
  return [owner?.handle ?? '', owner?.consumerGeneration ?? -1, owner?.processIncarnation ?? '']
}
