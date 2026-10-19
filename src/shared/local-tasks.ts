import { isLocalTaskStatus, type LocalTask } from './local-task'
import type { LocalTasksByProject } from './persisted-state-types'

export const LOCAL_TASK_URL_PREFIX = 'orca://local-task/v1/'

export function buildLocalTaskUrl(projectId: string, taskId: number): string {
  return `${LOCAL_TASK_URL_PREFIX}${projectId}/${taskId}`
}

// Why row-tolerant: one malformed stored row must never take down the rest of
// the domain. Malformed rows drop; a bad domain CONTAINER fails closed at the
// load layer (normalizeLoadedProfileState marks it unreadable), never here.
export function normalizeLocalTaskRow(value: unknown): LocalTask | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const raw = value as Record<string, unknown>
  const id = raw.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
    return null
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (title.length === 0) {
    return null
  }
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (url.length === 0) {
    return null
  }
  if (!isLocalTaskStatus(raw.status)) {
    return null
  }
  const createdAt = normalizeLocalTaskTimestamp(raw.createdAt)
  const updatedAt = normalizeLocalTaskTimestamp(raw.updatedAt)
  if (createdAt === null || updatedAt === null) {
    return null
  }
  return {
    id,
    url,
    title,
    description: typeof raw.description === 'string' ? raw.description : '',
    status: raw.status,
    createdAt,
    updatedAt
  }
}

function normalizeLocalTaskTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.floor(value)
}

// Why never prune here: the read normalizer owns row tolerance, but the
// catalog is not known-complete at read time — only the explicit
// project-removal write path may drop project keys (KTD2).
export function normalizeLocalTasksByProject(
  value: unknown
): Record<string, LocalTasksByProject> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const normalized: Record<string, LocalTasksByProject> = {}
  for (const [projectId, bucket] of Object.entries(value)) {
    if (projectId.length === 0 || typeof bucket !== 'object' || bucket === null) {
      continue
    }
    const raw = bucket as Record<string, unknown>
    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks
          .map(normalizeLocalTaskRow)
          .filter((task): task is LocalTask => task !== null)
          .sort((left, right) => left.id - right.id)
      : []
    const counter =
      typeof raw.nextLocalTaskId === 'number' &&
      Number.isSafeInteger(raw.nextLocalTaskId) &&
      raw.nextLocalTaskId >= 1
        ? Math.floor(raw.nextLocalTaskId)
        : null
    const maxId = tasks.reduce((max, task) => Math.max(max, task.id), 0)
    // Why clamp, not drop: a stale counter that lags behind surviving rows
    // would re-mint a live id on the next create; advancing past max keeps
    // ids unique without touching stored rows.
    const nextLocalTaskId = Math.max(counter ?? 1, maxId + 1)
    normalized[projectId] = { tasks, nextLocalTaskId }
  }
  return normalized
}
