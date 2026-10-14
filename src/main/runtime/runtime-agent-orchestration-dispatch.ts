import { AGENT_STATUS_STALE_AFTER_MS } from '../../shared/agent-status-types'
import type { OrchestrationDb } from './orchestration/db'

export function getRecentOrchestrationDispatch(handle: string, db: OrchestrationDb | null) {
  const dispatch = db?.getLatestDispatchForTerminal?.(handle)
  if (
    !dispatch?.completed_at ||
    dispatch.status === 'pending' ||
    dispatch.status === 'dispatched'
  ) {
    return undefined
  }
  const completedAt = Date.parse(
    dispatch.completed_at.includes('T')
      ? dispatch.completed_at
      : `${dispatch.completed_at.replace(' ', 'T')}Z`
  )
  return Number.isFinite(completedAt) && Date.now() - completedAt <= AGENT_STATUS_STALE_AFTER_MS
    ? dispatch
    : undefined
}
